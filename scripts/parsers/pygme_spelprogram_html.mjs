import * as cheerio from "cheerio";

function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function absUrl(base, href) {
  try {
    if (!href) return null;
    const h = String(href).trim();
    if (!h) return null;
    if (h.startsWith("http")) return h;
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

function parseTimeCell(text) {
  // ex: "13.00 & 15.00" eller "9.15 & 10.45" eller "10.00"
  const s = clean(text).toLowerCase();
  const m = s.match(/\b(\d{1,2})[.:](\d{2})\b/);
  if (!m) return null;
  const hh = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function monthIndexSv(m) {
  const key = clean(m).toLowerCase();
  const map = new Map([
    ["januari", 1],
    ["februari", 2],
    ["mars", 3],
    ["april", 4],
    ["maj", 5],
    ["juni", 6],
    ["juli", 7],
    ["augusti", 8],
    ["september", 9],
    ["oktober", 10],
    ["november", 11],
    ["december", 12],
  ]);
  return map.get(key) || null;
}

function inferSeasonYear(monthNum) {
  // Importen filtrerar hårt: -2 dagar bakåt, +365 dagar framåt.
  // Sidan listar typ "januari, februari..." utan år.
  // Robust heuristik: om vi är i jan/feb och vi ser dec => dec hör till föregående år.
  // Om vi är i nov/dec och vi ser jan/feb => hör till nästa år.
  const now = new Date();
  const y = now.getFullYear();
  const curM = now.getMonth() + 1;

  if (curM >= 11 && monthNum <= 2) return y + 1;
  if (curM <= 2 && monthNum >= 11) return y - 1;
  return y;
}

function ymd(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export async function importPygmeSpelprogramHtml(source) {
  if (!source || !source.url) throw new Error("Missing source.url");

  const res = await fetch(source.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const html = buf.toString("latin1");

  const $ = cheerio.load(html);

  const items = [];
  const baseUrl = source.url;

  // Strukturen vi såg:
  // <tr><td class="tableHead" colspan=3>januari</td></tr>
  // <tr>
  //   <td ...>tis 20</td>
  //   <td ...><b><a href="...">Titel</a></b></td>
  //   <td ...>10.00</td>
  // </tr>
  let curMonthNum = null;
  let curYear = null;

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (!tds || tds.length === 0) return;

    // Month header row
    const head = $(tr).find("td.tableHead");
    if (head && head.length) {
      const m = monthIndexSv(head.first().text());
      if (m) {
        curMonthNum = m;
        curYear = inferSeasonYear(m);
      }
      return;
    }

    // Expect 3 columns for rows with dates
    if (tds.length < 3) return;
    if (!curMonthNum || !curYear) return;

    const left = clean($(tds[0]).text()); // ex "tis 20"
    const midA = $(tds[1]).find("a").first();
    const title = clean(midA.text());
    const href = midA.attr("href") || null;
    const timeText = clean($(tds[2]).text());

    const dayM = left.match(/\b(\d{1,2})\b/);
    const day = dayM ? Number(dayM[1]) : null;
    if (!day || !Number.isFinite(day)) return;

    const time = parseTimeCell(timeText) || "15:00:00";
    const date = ymd(curYear, curMonthNum, day);
    const start_at = `${date}T${time}`;

    // CTA/ticket:
    // - ibland kulturbiljetter evenemang/xxxx (bra)
    // - ibland interna .asp eller teatercentrum-länk (mer info)
    const u = absUrl(baseUrl, href);
    const isKulturbiljetter = u ? /kulturbiljetter\.se\/evenemang\//i.test(u) : false;
    const isInternalAsp = u ? (/pygmeteatern\.se\/(?:se\/)?[^\s]+\.asp(\?.*)?$/i.test(u) && !/spelprogram\.asp$/i.test(u) && !/default\.asp$/i.test(u)) : false;

    items.push({
      title: title || "Pygméteatern",
      start_at,
      end_at: null,
      city: source.city || "Stockholm",
      venue_name: "Pygméteatern",
      ticket_url: isKulturbiljetter ? u : null,
      organizer_url: "http://www.pygmeteatern.se/se/",
      source_url: baseUrl,          // stable listing page
      listing_url: baseUrl,
      description: isKulturbiljetter
        ? null
        : (u ? `Mer info: ${u}` : null),
      price_type: "unknown",
      image_url: (((t)=> (t.includes("spöken") || (t.includes("sp") && t.includes("ken") && t.includes("rym"))) )((title||"").toLowerCase()) ? "https://www.pygmeteatern.se/img/press/3spoken_press.jpg" : (((t)=> (t.includes("sagan som rymde") || (t.includes("sagan") && t.includes("rym"))) )((title||"").toLowerCase()) ? "https://www.pygmeteatern.se/img/press/skogstroll2_p.jpg" : null)),
      details_url: isInternalAsp ? u : (((title||"").toLowerCase().includes("spöken")) ? "http://www.pygmeteatern.se/se/spoken.asp" : null),
    });
  });
  // Enrich images from internal detail pages (e.g. sagan.asp -> /img/bilder/t_*.jpg)
  for (const it of items) {
    if (it.image_url) continue;
    const du = it.details_url;
    if (!du) continue;
    try {
      const r = await fetch(du, { redirect: "follow" });
      if (!r.ok) continue;
      const h = await r.text();
      const m = h.match(/<img[^>]+src=["' ]?(\.\.\/img\/bilder\/[^"' >]+\.jpg)/i);
      if (m && m[1]) {
        it.image_url = absUrl("http:\/\/www.pygmeteatern.se\/se\/", m[1]);
      }
    } catch {}
  }

  return items;
}

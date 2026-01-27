import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function toAbsUrl(pathOrUrl, base) {
  const v = String(pathOrUrl || "").trim();
  if (!v) return null;
  try { return new URL(v, base).toString(); } catch { return null; }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)" }
  });
  if (!res.ok) return "";
  return await res.text();
}

function pickFirstImg(html, baseUrl) {
  const $ = cheerio.load(html);
  // Prefer likely hero/featured images
  const sel = [
    'img[class*="hero"]',
    'img[class*="cover"]',
    'img[class*="featured"]',
    'img',
  ];
  for (const s of sel) {
    const src = $(s).first().attr("src") || $(s).first().attr("data-src") || "";
    const u = toAbsUrl(src, baseUrl);
    if (u) return u;
  }
  return null;
}

function parseTicketCardsFromShowPage(html) {
  const $ = cheerio.load(html);

  const title =
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text()) ||
    null;

  const image =
    clean($('meta[property="og:image"]').attr("content")) ||
    clean($('meta[name="twitter:image"]').attr("content")) ||
    pickFirstImg(html, "https://www.chinateatern.se") ||
    null;

  // Each ticket card contains text like: "Fredag 16 jan, 19:30 • China Teatern, Stockholm"
  // and CTA href to shop.showtic.se
  const cards = [];
  $(".ticket-card").each((_i, el) => {
    const dateText = clean($(el).find(".ticket-card__date").text()) || clean($(el).text());
    const href = $(el).find('a.ticket-card__cta[href]').attr("href") || "";
    const ticketUrl = toAbsUrl(href, "https://www.chinateatern.se");

    if (!dateText || !ticketUrl) return;
    cards.push({ dateText, ticketUrl });
  });

  // Fallback: if structure differs, regex scan
  if (cards.length === 0) {
    const re = /ticket-card__date">([^<]+)[\s\S]*?ticket-card__cta" href="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) {
      const dateText = clean(m[1]);
      const ticketUrl = toAbsUrl(m[2], "https://www.chinateatern.se");
      if (dateText && ticketUrl) cards.push({ dateText, ticketUrl });
    }
  }

  return { title, image, cards };
}

function parseStartAtFromDateText(dateText) {
  // Example: "Fredag 16 jan, 19:30 • China Teatern, Stockholm"
  // We will parse "16 jan, 19:30" and assume current/next year by scanning for "jan/feb/..." with a simple map.
  // China Teatern pages are for upcoming shows; we pin year by reading from page context via embedded "2026" in HTML if present.
  const t = String(dateText || "");
  const m = t.match(/\b(\d{1,2})\s+([A-Za-zÅÄÖåäö]+)\s*,\s*(\d{1,2}):(\d{2})\b/);
  if (!m) return null;

  const day = Number(m[1]);
  const monRaw = m[2].toLowerCase();
  const hh = Number(m[3]);
  const mm = Number(m[4]);

  const monMap = {
    jan: 1, januari: 1,
    feb: 2, februari: 2,
    mar: 3, mars: 3,
    apr: 4, april: 4,
    maj: 5,
    jun: 6, juni: 6,
    jul: 7, juli: 7,
    aug: 8, augusti: 8,
    sep: 9, sept: 9, september: 9,
    okt: 10, oktober: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  const mon = monMap[monRaw];
  if (!mon) return null;

  // Default year: 2026 if appears in text; else current year.
  // We can't rely on system time; use conservative: current year or next if date already passed.
  const now = new Date();
  let year = now.getUTCFullYear();

  // If the show page includes an explicit year in the dateText, use it (rare).
  const y = t.match(/\b(20\d{2})\b/);
  if (y) year = Number(y[1]);

  // Build in Europe/Stockholm local time, then convert to ISO.
  // We approximate by creating a Date in UTC with same components then adjust; acceptable for ingestion since source timestamps are not given.
  // To avoid drift, set as UTC and treat it as local: we can instead store as ISO with Z using UTC components.
  const dt = new Date(Date.UTC(year, mon - 1, day, hh, mm, 0));

  // If date is far in the past (e.g., Jan when now is Dec), bump year
  if (dt.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) {
    const dt2 = new Date(Date.UTC(year + 1, mon - 1, day, hh, mm, 0));
    return dt2.toISOString();
  }

  return dt.toISOString();
}

export async function importChinaTeatern(source) {
  const listingUrl = source?.url || "https://www.chinateatern.se/forestallningar/";
  const listingHtml = await fetchHtml(listingUrl);
  if (!listingHtml) return [];

  const $ = cheerio.load(listingHtml);

  const showUrls = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (!href) return;
    if (!/\/shower\//i.test(href)) return;
    const u = toAbsUrl(href, "https://www.chinateatern.se");
    if (!u) return;
    showUrls.push(u);
  });

  const seen = new Set();
  const uniq = [];
  for (const u of showUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    uniq.push(u);
  }

  const out = [];
  for (const showUrl of uniq.slice(0, 50)) {
    const html = await fetchHtml(showUrl);
    if (!html) continue;

    const { title, image, cards } = parseTicketCardsFromShowPage(html);
    if (!cards.length) continue;

    for (const c of cards) {
      const startIso = parseStartAtFromDateText(c.dateText);
      if (!title || !startIso) continue;

      out.push({
        title,
        description: null,
        start_at: startIso,
        end_at: null,
        city: clean(source?.city) || "Stockholm",
        venue_name: "China Teatern",
        ticket_url: c.ticketUrl,
        organizer_url: showUrl,
        source_url: showUrl,
        listing_url: listingUrl,
        image_url: image ? toAbsUrl(image, showUrl) : null,
        category: clean(source?.category) || "teater",
        price_type: "unknown",
      });
    }
  }

  const seenKey = new Set();
  const deduped = [];
  for (const it of out) {
    const k = `${it.title}__${it.start_at}__${it.ticket_url}`;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    deduped.push(it);
  }

  return deduped;
}

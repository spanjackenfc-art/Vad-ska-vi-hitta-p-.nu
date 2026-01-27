import * as cheerio from "cheerio";

const BASE = "https://kulturbiljetter.se";

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE + href;
  return BASE + "/" + href;
}

function pickVenueFromLocations(loc) {
  const s = (loc || "").trim();
  if (!s) return null;
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  if (parts.length >= 1) return parts[parts.length - 1];
  return s;
}

function inferAudienceFromTitle(title) {
  const t = (title || "").toLowerCase();
  if (/\b\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*år\b/.test(t)) return "familj";
  if (/\b0\s*-\s*\d+\s*år\b/.test(t)) return "familj";
  if (/\(\s*\d/.test(t) && t.includes("år")) return "familj";
  return null;
}

function parseSvMonthToNum(mon) {
  const m = (mon || "").toLowerCase().trim();
  const map = {
    jan: 1, januari: 1,
    feb: 2, februari: 2,
    mar: 3, mars: 3,
    apr: 4, april: 4,
    maj: 5,
    jun: 6, juni: 6,
    jul: 7, juli: 7,
    aug: 8, augusti: 8,
    sep: 9, september: 9,
    okt: 10, oktober: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return map[m] || null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Returnerar första framtida showtime från en Kulturbiljetter event-sida.
// Output: { start_at: "YYYY-MM-DDTHH:MM:00", ticket_url: "https://..." } eller null.
async function fetchFirstFutureShow(sourceUrl) {
  const res = await fetch(sourceUrl, {
    headers: { "user-agent": "sverige-event-bot/1.0 (+https://vadskavihittapå.nu)", "accept": "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  // .edid-list .edid  (framtida saknar .past-grey)
  const first = $(".edid-list .edid").not(".past-grey").first();
  if (!first.length) return null;

  const strong = first.find("strong").first().text().trim(); // ex "31 jan" eller " 4 mar"
  const yearText = first.find("span.year").first().text().trim(); // ibland tomt
  const lineText = first.text().replace(/\s+/g, " ").trim(); // innehåller "kl 11.00"
  const aHref = first.find("a").first().attr("href") || null;

  // strong brukar vara "31 jan" eller "4 mar"
  const m = strong.match(/(\d{1,2})\s*([A-Za-zåäöÅÄÖ]+)/);
  if (!m) return null;
  const day = Number(m[1]);
  const monNum = parseSvMonthToNum(m[2]);
  if (!monNum) return null;

  // tid: "kl 11.00" => 11:00
  const tm = lineText.match(/\bkl\s*(\d{1,2})[.:](\d{2})\b/i);
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);

  // år: om saknas, anta innevarande år, men om datum redan passerat, bump +1
  const now = new Date();
  let year = yearText ? Number(yearText) : now.getFullYear();

  // Bygg datum i lokal tid (CET/CEST hanteras inte explicit här; ingestion använder ISO)
  let candidate = new Date(year, monNum - 1, day, hh, mm, 0, 0);
  if (!yearText && candidate.getTime() < now.getTime() - 24 * 3600 * 1000) {
    year += 1;
    candidate = new Date(year, monNum - 1, day, hh, mm, 0, 0);
  }

  const start_at = `${candidate.getFullYear()}-${pad2(candidate.getMonth() + 1)}-${pad2(candidate.getDate())}T${pad2(candidate.getHours())}:${pad2(candidate.getMinutes())}:00`;

  return {
    start_at,
    ticket_url: absUrl(aHref),
  };
}

export async function importKulturbiljetterArrangor(source) {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": "sverige-event-bot/1.0 (+https://vadskavihittapå.nu)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Kulturbiljetter fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cards = [];
  $(".serp .serp-cell").each((_, el) => {
    const root = $(el);

    const title = root.find("h2").first().text().trim() || null;

    const eventHref = root.find('a[href^="/evenemang/"]').first().attr("href") || null;
    const cartHref = root.find('a[href^="/varukorg/"]').first().attr("href") || null;

    const imgSrc = root.find("img").first().attr("src") || null;

    const locationsText = root.find(".locations").first().text().trim() || null;
    const venue = pickVenueFromLocations(locationsText) || source.venue_name || null;

    if (!title || !eventHref) return;

    cards.push({
      title,
      event_url: absUrl(eventHref),
      fallback_ticket_url: absUrl(cartHref),
      image_url: absUrl(imgSrc),
      venue_name: venue,
      audience: inferAudienceFromTitle(title),
    });
  });

  const items = [];
  for (const c of cards) {
    const show = await fetchFirstFutureShow(c.event_url);
    if (!show || !show.start_at) continue;

    items.push({
      title: c.title,
      description: null,
      start_at: show.start_at,
      end_at: null,
      city: source.city || null,
      venue_name: c.venue_name,
      ticket_url: show.ticket_url || c.fallback_ticket_url,
      organizer_url: c.event_url,
      source_url: c.event_url,
      listing_url: source.url,
      image_url: c.image_url,
      category: "teater",
      subcategory: null,
      audience: c.audience,
      price_type: "unknown",
    });
  }

  return items;
}

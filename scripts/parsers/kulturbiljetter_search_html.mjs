import * as cheerio from "cheerio";

const BASE = "https://kulturbiljetter.se";

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE + href;
  return BASE + "/" + href;
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

function inferAudienceFromTitle(title) {
  const t = (title || "").toLowerCase();
  if (/\b\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*år\b/.test(t)) return "familj";
  if (/\b0\s*-\s*\d+\s*år\b/.test(t)) return "familj";
  if (/\(\s*\d/.test(t) && t.includes("år")) return "familj";
  return null;
}

function pickVenueFromLocations(loc) {
  const s = (loc || "").trim();
  if (!s) return null;
  // "STOCKHOLM, Vasastan, Teater Giljotin" => "Teater Giljotin"
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

function isStockholmLocations(loc) {
  const s = (loc || "").trim().toUpperCase();
  return s.startsWith("STOCKHOLM,");
}

async function fetchFirstFutureShow(eventUrl) {
  const res = await fetch(eventUrl, {
    headers: { "user-agent": "sverige-event-bot/1.0 (+https://vadskavihittapå.nu)", "accept": "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  const first = $(".edid-list .edid").not(".past-grey").first();
  if (!first.length) return null;

  const strong = first.find("strong").first().text().trim(); // "18 feb"
  const yearText = first.find("span.year").first().text().trim(); // ibland tomt
  const lineText = first.text().replace(/\s+/g, " ").trim();
  const aHref = first.find("a").first().attr("href") || null;

  const m = strong.match(/(\d{1,2})\s*([A-Za-zåäöÅÄÖ]+)/);
  if (!m) return null;
  const day = Number(m[1]);
  const monNum = parseSvMonthToNum(m[2]);
  if (!monNum) return null;

  const tm = lineText.match(/\bkl\s*(\d{1,2})[.:](\d{2})\b/i);
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);

  const now = new Date();
  let year = yearText ? Number(yearText) : now.getFullYear();

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

export async function importKulturbiljetterSearch(source) {
  const u = new URL(source.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (!q) throw new Error("Kulturbiljetter search source.url must include ?q=...");

  const body = new URLSearchParams();
  body.set("ajax", "1");
  body.set("query", JSON.stringify({
    string: q,
    dates: [],
    aids: null,
    offset: 0,
    limit: 50,
    moreButton: false,
    random: false,
  }));

  const res = await fetch(`${BASE}/search/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "sverige-event-bot/1.0 (+https://vadskavihittapå.nu)",
      "accept": "text/html",
    },
    body,
  });

  if (!res.ok) throw new Error(`Kulturbiljetter search failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cards = [];
  $(".serp-cell").each((_, el) => {
    const root = $(el);
    const title = root.find("h2").first().text().trim() || null;
    const eventHref = root.find('a[href^="/evenemang/"]').first().attr("href") || null;
    const cartHref = root.find('a[href^="/varukorg/"]').first().attr("href") || null;
    const imgSrc = root.find("img").first().attr("src") || null;
    const locText = root.find(".locations").first().text().trim() || null;

    if (!title || !eventHref) return;
    if (!isStockholmLocations(locText)) return;

    cards.push({
      title,
      event_url: absUrl(eventHref),
      fallback_ticket_url: absUrl(cartHref),
      image_url: absUrl(imgSrc),
      locations: locText,
      venue_name: pickVenueFromLocations(locText),
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
      city: source.city || "Stockholm",
      venue_name: c.venue_name || null,
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

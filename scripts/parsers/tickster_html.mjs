import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  return String(x).trim().replace(/\s+/g, " ");
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

function absolutize(base, href) {
  try {
    return new URL(String(href || ""), base).toString();
  } catch {
    return null;
  }
}

const MONTHS = {
  jan: 0, januari: 0,
  feb: 1, februari: 1,
  mar: 2, mars: 2,
  apr: 3, april: 3,
  maj: 4,
  jun: 5, juni: 5,
  jul: 6, juli: 6,
  aug: 7, augusti: 7,
  sep: 8, september: 8,
  okt: 9, oktober: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function toISO_UTC(y, mo, d) {
  // Tickster-listan saknar tid => vi sätter 12:00 UTC som “mitt på dagen” för MVP
  return new Date(Date.UTC(y, mo, d, 12, 0, 0)).toISOString();
}

function parseTicksterLabelDate(label) {
  // label exempel: "4 jan 2026, Historiska Museet i Stockholm"
  const t = (label || "").toLowerCase();
  const m = t.match(/^\s*(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|september|okt|oktober|nov|november|dec|december)\s+(\d{4})\s*,/i);
  if (!m) return null;

  const day = Number(m[1]);
  const mon = MONTHS[m[2]];
  const year = Number(m[3]);
  if (mon === undefined) return null;

  return toISO_UTC(year, mon, day);
}

function parseVenueFromLabel(label) {
  // label: "4 jan 2026, Historiska Museet i Stockholm"
  const t = clean(label);
  if (!t) return null;
  const idx = t.indexOf(",");
  if (idx === -1) return null;
  return clean(t.slice(idx + 1));
}

function inferCity(venueText, fallbackCity) {
  const v = (venueText || "").toLowerCase();
  if (v.endsWith(", stockholm") || v.includes(" stockholm")) return "Stockholm";
  if (v.endsWith(", göteborg") || v.includes(" göteborg")) return "Göteborg";
  return fallbackCity || null;
}

export async function importTickster(source) {
  const seenPages = new Set();
  const queue = [source.url];
  const out = [];

  while (queue.length) {
    const pageUrl = queue.shift();
    if (!pageUrl || seenPages.has(pageUrl)) continue;
    seenPages.add(pageUrl);

    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);

    // Alla köpknappar med data-name är kandidater, oavsett partnerdomän.
    $("a[data-name][data-eventrequestcode]").each((_, a) => {
      const $a = $(a);
      const ticket_url = absolutize(pageUrl, $a.attr("href"));
      const title = clean($a.attr("data-name")) || null;

      const $label = $a.closest("div").find("span.c-tile__label").first();
      const labelText = clean($label.text()) || null;

      const start_at = labelText ? parseTicksterLabelDate(labelText) : null;
      const venue_name = labelText ? parseVenueFromLabel(labelText) : null;
      const city = inferCity(venue_name, source.city);

      if (!title || !start_at || !ticket_url) return;

      out.push({
        title,
        start_at,
        end_at: null,
        venue_name,
        city,
        ticket_url,
        source_url: pageUrl,
      });
    });

    const nextHref = $("a.c-pager__page[title*='Nästa sida'], a.c-pager__page[title*='N\u00e4sta sida']").first().attr("href");
    const nextUrl = absolutize(pageUrl, nextHref);
    if (nextUrl && !seenPages.has(nextUrl)) queue.push(nextUrl);
  }

  const dedup = new Map();
  for (const e of out) {
    const k = e.ticket_url;
    if (!dedup.has(k)) dedup.set(k, e);
  }

  return Array.from(dedup.values());
}

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

function extractShowUrlsFromListing(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (!href) return;
    if (!/\/shower\//i.test(href)) return;
    const abs = toAbsUrl(href, baseUrl);
    if (!abs) return;
    urls.push(abs.replace(/\/$/, ""));
  });
  const seen = new Set();
  return urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

function parseShowTitle(html) {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:title"]').attr("content") || "";
  const h1 = $("h1").first().text();
  const t = clean(og) || clean(h1) || null;
  if (!t) return null;
  return t.replace(/\s*\|\s*Oscarsteatern\s*$/i, "").trim();
}

function parseOgImage(html) {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content") || "";
  return clean(og) || null;
}

// Strategy: Show pages do not expose showtimes in JSON-LD. We still ingest the show as a landing-page event
// with a synthetic start_at far in the future to keep it visible only if you later add showtimes ingestion.
// For now, we DO NOT ingest these as events (would pollute with fake dates). Return 0 items.
export async function importOscarsteatern(_source) {
  // Not ingesting until we have real showtimes feed.
  return [];
}

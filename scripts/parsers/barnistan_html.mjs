import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  return String(x).trim().replace(/\s+/g, " ");
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
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
  return new Date(Date.UTC(y, mo, d, 12, 0, 0)).toISOString();
}

function parseSwedishDateFromText(raw) {
  const t0 = (raw || "");
  const t = t0.toLowerCase();

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  const isoNoonUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)).toISOString();

  // 0) "idag" / "imorgon"
  if (/\bidag\b/.test(t)) return today.toISOString();
  if (/\bimorgon\b/.test(t)) {
    const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return d.toISOString();
  }

  // 1) With year: "12 januari 2026"
  let m = t.match(/(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|september|okt|oktober|nov|november|dec|december)\s+(\d{4})/i);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2]];
    const year = Number(m[3]);
    if (mon === undefined) return null;
    return toISO_UTC(year, mon, day);
  }

  // 2) Date range: "12-14 jan" / "12–14 januari"
  m = t.match(/(\d{1,2})\s*(?:-|–)\s*(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|september|okt|oktober|nov|november|dec|december)(?:\s+(\d{4}))?/i);
  if (m) {
    const dayStart = Number(m[1]);
    const mon = MONTHS[m[3]];
    const yearRaw = m[4] ? Number(m[4]) : null;
    if (mon === undefined) return null;

    const y0 = now.getFullYear();
    const year = yearRaw ?? y0;
    // if inferred year and date already passed by >2 days, bump to next year
    const cand = new Date(Date.UTC(year, mon, dayStart, 12, 0, 0));
    const marginMs = 2 * 24 * 60 * 60 * 1000;
    const finalYear = (!yearRaw && (cand.getTime() + marginMs < now.getTime())) ? (year + 1) : year;
    return toISO_UTC(finalYear, mon, dayStart);
  }

  // 3) Without year: "12 januari" -> infer year (this or next)
  m = t.match(/(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|september|okt|oktober|nov|november|dec|december)\b/i);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2]];
    if (mon === undefined) return null;

    const y0 = now.getFullYear();
    const cand0 = new Date(Date.UTC(y0, mon, day, 12, 0, 0));
    const marginMs = 2 * 24 * 60 * 60 * 1000;
    const year = (cand0.getTime() + marginMs < now.getTime()) ? (y0 + 1) : y0;
    return toISO_UTC(year, mon, day);
  }

  // 4) Weekday: "lördag" / "söndag" / etc -> next occurrence
  const WD = {
    "måndag": 1, "mandag": 1,
    "tisdag": 2,
    "onsdag": 3,
    "torsdag": 4,
    "fredag": 5,
    "lördag": 6, "lordag": 6,
    "söndag": 0, "sondag": 0,
  };

  for (const [k, target] of Object.entries(WD)) {
    const r = new RegExp("\\b" + k + "\\b");
    if (!r.test(t)) continue;

    const cur = today.getUTCDay(); // 0..6
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7; // "på lördag" means next, not today
    const d = new Date(today.getTime() + delta * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }

  // 5) If nothing matches, give up (we do NOT want wrong dates)
  return null;
}


function absUrl(base, href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return new URL(href, base).toString();
  return new URL("/" + href, base).toString();
}

function isBadExternalUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.startsWith("mailto:")) return true;
  if (lower.startsWith("webcal:")) return true;
  if (lower.startsWith("data:")) return true;
  if (lower.startsWith("javascript:")) return true;

  try {
    const url = new URL(s);
    const proto = url.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return true;

    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.endsWith("barnistan.se")) return true; // never treat barnistan as official
    if (host.endsWith("dn.se")) return true;
    if (host.endsWith("welma.se")) return true;
    if (host.endsWith("konto.bonniernews.se")) return true;

    // social/share
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return true;
    if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com") || host.endsWith(".x.com")) return true;
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return true;

    // calendar/ics
    if (host.endsWith("calendar.google.com")) return true;
    if ((url.pathname || "").toLowerCase().endsWith(".ics")) return true;

    const path = (url.pathname || "").toLowerCase();
    if (path.includes("/share") || path.includes("/sharer.php") || path.includes("/intent/")) return true;
    if (url.searchParams.has("share") || url.searchParams.has("shared")) return true;

    return false;
  } catch {
    return true;
  }
}

function pickOfficialUrl($, baseUrl) {
  // Prefer links that look like tickets/booking
  const cands = [];

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    const abs = absUrl(baseUrl, href);
    if (!abs) return;

    // only external candidates
    const isExternal = abs.startsWith("http") && !abs.includes("barnistan.se");
    if (!isExternal) return;

    if (isBadExternalUrl(abs)) return;

    const text = (clean($(a).text()) || "").toLowerCase();
    const score =
      (text.includes("biljett") ? 50 : 0) +
      (text.includes("boka") ? 30 : 0) +
      (text.includes("köp") ? 30 : 0) +
      (text.includes("tickets") ? 30 : 0) +
      (text.includes("bokning") ? 20 : 0);

    cands.push({ url: abs, score });
  });

  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.url || null;
}

async function extractDetail(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title =
    clean($("h1").first().text()) ||
    clean($("title").text()) ||
    null;

  const bodyText = clean($("body").text()) || "";
  const start_at = parseSwedishDateFromText(bodyText);

  const official_url = pickOfficialUrl($, url);

  return { title, start_at, official_url };
}

export async function importBarnistan(source) {
  const listingUrl = source.url;
  const html = await fetchHtml(listingUrl);
  const $ = cheerio.load(html);

  // Samla interna länkar som ser ut som artiklar/event.
  const links = [];
  // Pagination: hämta flera listningssidor (Barnistan har ofta ?page=2..)
  const listingPages = [];
  for (let page = 1; page <= 5; page++) {
    if (page === 1) listingPages.push(listingUrl);
    else listingPages.push(listingUrl + (listingUrl.includes("?") ? "&" : "?") + "page=" + page);
  }

  for (const pageUrl of listingPages) {
    let html;
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }
    const $page = cheerio.load(html);

    $page("a").each((_, a) => {
      const $a = $page(a);
      const href = $a.attr("href");
      const text = clean($a.text());
      const abs = absUrl(pageUrl, href);

      if (!abs || !abs.includes("barnistan.se")) return;

      // grov filtrering bort från “om oss”, “kontakt” etc
      if (abs.includes("/kontakt") || abs.includes("/om-")) return;

      // undvik ankare
      if (abs.includes("#")) return;

      // URL-filter: behåll endast troliga detaljsidor, inte nav/sektioner
      // Exkludera vanliga nav/sektioner
      const path = (() => { try { return new URL(abs).pathname.toLowerCase(); } catch { return ""; } })();
      if (!path) return;

      // bort med uppenbara nav/listningar
      if (path === "/") return;
      if (path === "/tips/") return;
      if (path === "/tips/evenemang/") return;
      if (path.startsWith("/omoss")) return;
      if (path.startsWith("/nyhetsbrev")) return;

      // kräva att det finns "djup" (minst 3 path-segment), t.ex. /tips/evenemang/<slug>/
      const segs = path.split("/").filter(Boolean);
      if (segs.length < 3) return;

      // lite mjukare: ibland är länktexten kort men ändå event
      if (text && text.length >= 4) links.push({ url: abs });
    });
  }

  // Höj taket för volym (Barnistan är volym-källa)
  const dedup = Array.from(new Set(links.map((x) => x.url))).slice(0, 400);
  const out = [];
  for (const url of dedup) {
    const d = await extractDetail(url);
    if (!d.start_at || !d.title) continue;

    // Filter away non-event navigation/guide pages that slip in from broad link collection
    const t = String(d.title || "").toLowerCase();
    const isBadTitle = (() => {
  const t0 = String(d.title || "").toLowerCase().trim();
  if (!t0) return true;

  // Snäv blacklist: endast uppenbara icke-event/infosidor
  if (t0.includes("jobba med")) return true;
  if (t0.includes("databas")) return true;
  if (t0.includes("om oss")) return true;
  if (t0.includes("kontakt")) return true;
  if (t0.includes("annonser")) return true;

  return false;
})();
if (isBadTitle) continue;
    // Barnistan ska aldrig vara ticket_url. Officiell url om den finns, annars null.
    const official = d.official_url || null;

    out.push({
      title: d.title,
      start_at: d.start_at,
      end_at: null,
      venue_name: null,
      city: source.city ?? "Stockholm",

      // Viktigt för volym: sätt kategori direkt
      category: "familj",
      subcategory: "barnistan",

      // spårbarhet
      source_url: url,
      listing_url: listingUrl,

      // CTA/official
      ticket_url: official,
      organizer_url: official,
    });
  }

  // dedup
  const final = new Map();
  for (const e of out) final.set(`${e.source_url}__${e.start_at}`, e);
  return Array.from(final.values());
}

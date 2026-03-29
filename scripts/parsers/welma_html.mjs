import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function toAbsUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

const MONTHS = new Map([
  ["jan", 1], ["januari", 1],
  ["feb", 2], ["februari", 2],
  ["mar", 3], ["mars", 3],
  ["apr", 4], ["april", 4],
  ["maj", 5],
  ["jun", 6], ["juni", 6],
  ["jul", 7], ["juli", 7],
  ["aug", 8], ["augusti", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["okt",10], ["oktober",10],
  ["nov",11], ["november",11],
  ["dec",12], ["december",12],
]);

function isValidYmd(y, m, d) {
  if (!(y >= 1970 && y <= 2100)) return false;
  if (!(m >= 1 && m <= 12)) return false;
  if (!(d >= 1 && d <= 31)) return false;
  return true;
}

function toISOAtNoonUTC(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toISOString();
}

function parseWelmaStartDate(text, now = new Date()) {
  const src = (text || "");

  // "DD–DD mon"
  {
    const re = /\b(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|sept|september|okt|oktober|nov|november|dec|december)\b/i;
    const m = re.exec(src);
    if (m) {
      const d1 = Number(m[1]);
      const mon = MONTHS.get(m[3].toLowerCase());
      if (!mon) return null;

      const y0 = now.getUTCFullYear();
      const guess = (y) => (isValidYmd(y, mon, d1) ? toISOAtNoonUTC(y, mon, d1) : null);

      const isoThis = guess(y0);
      if (!isoThis) return null;

      const ts = Date.parse(isoThis);
      if (ts < now.getTime() - 1000 * 60 * 60 * 24 * 2) return guess(y0 + 1);

      return isoThis;
    }
  }

  // "DD mon [YYYY]"
  {
    const re = /\b(\d{1,2})\s+(jan|januari|feb|februari|mar|mars|apr|april|maj|jun|juni|jul|juli|aug|augusti|sep|sept|september|okt|oktober|nov|november|dec|december)\s*(\d{4})?\b/i;
    const m = re.exec(src);
    if (m) {
      const d = Number(m[1]);
      const mon = MONTHS.get(m[2].toLowerCase());
      if (!mon) return null;

      let y = m[3] ? Number(m[3]) : now.getUTCFullYear();
      if (!isValidYmd(y, mon, d)) return null;

      let iso = toISOAtNoonUTC(y, mon, d);

      if (!m[3]) {
        const ts = Date.parse(iso);
        if (ts < now.getTime() - 1000 * 60 * 60 * 24 * 2) {
          y = y + 1;
          if (!isValidYmd(y, mon, d)) return null;
          iso = toISOAtNoonUTC(y, mon, d);
        }
      }
      return iso;
    }
  }

  return null;
}

function pickText($root, sel) {
  const v = clean($root.find(sel).first().text());
  return v || null;
}

export async function importWelma({ html, source }) {
  const $ = cheerio.load(html);
  const now = new Date();

  const items = [];
  const seen = new Set();

  $("article.suggestion-teaser-large").each((_, el) => {
    const card = $(el);

    const a = card.find("a.suggestion-teaser-large__link").first();
    const abs = toAbsUrl(a.attr("href"), source.url);
    if (!abs) return;

    // Title: strukturbaserat
    const title =
      pickText(card, ".suggestion-teaser-large__content__title h3") ||
      pickText(card, ".suggestion-teaser-large__content__title") ||
      pickText(card, "h3") ||
      clean(a.attr("aria-label")) ||
      clean(a.text());

    if (!title || title.length < 3) return;

    // Description & venue (strukturbaserat)
    const description = pickText(card, ".suggestion-teaser-large__content__text") || null;
    const venue_name = pickText(card, ".suggestion-teaser-large__content__location") || null;

    // Datum: använd hela kortets text för datumdetektion (Welma renderar datum i teaser/metadata)
// Vi behåller title/venue/description strukturerat men använder cardText som datumkälla.
const labels = pickText(card, ".suggestion-teaser-large__labels") || "";
const cardText = clean(card.text()) || "";
const dateCorpus = [cardText, labels].filter(Boolean).join(" ");
const startISO = parseWelmaStartDate(dateCorpus, now);
    if (!startISO) return;

    const isFree = /gratis/i.test(labels) || /gratis/i.test(dateCorpus);

    const key = `${abs}__${startISO}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      title,
      start_at: startISO,
      end_at: null,
      venue_name,
      description,
      ticket_url: abs,
      source_url: source.url,
      price_type: isFree ? "free" : "unknown",
      price_min: isFree ? 0 : null,
      price_max: isFree ? 0 : null,
    });
  });

  items.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return items;
}

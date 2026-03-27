import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  return String(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absUrl(href, base = "https://www.gotalejon.se/") {
  const h = String(href || "").trim();
  if (!h) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

function pickImage($a) {
  const img = $a.find("img").first();
  const src = clean(img.attr("src"));
  if (src) return src;

  const srcset = clean(img.attr("srcset"));
  if (!srcset) return null;

  const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
  return clean(first) || null;
}

function parseSvDate(text) {
  const s = String(text || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const mon = {
    jan: 0, januari: 0,
    feb: 1, februari: 1,
    mar: 2, mars: 2,
    apr: 3, april: 3,
    maj: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    aug: 7, augusti: 7,
    sep: 8, sept: 8, september: 8,
    okt: 9, oktober: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  let m = s.match(/(\d{1,2})\s+([a-zåäö]+)\s+(20\d{2})/i);
  if (m) {
    const dd = Number(m[1]);
    const mm = mon[m[2]];
    const yy = Number(m[3]);
    if (mm == null) return null;
    return new Date(Date.UTC(yy, mm, dd, 12, 0, 0)).toISOString();
  }

  m = s.match(/(\d{1,2})\s+([a-zåäö]+)\b/i);
  if (m) {
    const dd = Number(m[1]);
    const mm = mon[m[2]];
    if (mm == null) return null;
    let yy = new Date().getUTCFullYear();
    const cand = new Date(Date.UTC(yy, mm, dd, 12, 0, 0));
    const threshold = Date.now() - 1000 * 60 * 60 * 24 * 40;
    if (cand.getTime() < threshold) yy += 1;
    return new Date(Date.UTC(yy, mm, dd, 12, 0, 0)).toISOString();
  }

  return null;
}

function inferTitle($a) {
  const heading =
    clean($a.find('p[class*="MuiTypography-header3"]').first().text()) ||
    clean($a.find('p[class*="header3"]').first().text()) ||
    clean($a.find("h1,h2,h3,h4").first().text()) ||
    clean($a.attr("aria-label"));
  if (heading) return heading;

  const txt = clean($a.text()) || "";
  const stripped = txt
    .replace(/\bSök biljett(er)?\b/ig, "")
    .replace(/\b\d{1,2}\s+[A-Za-zÅÄÖåäö.]+\s*(?:\d{4})?(?:\s*[-–]\s*\d{1,2}\s+[A-Za-zÅÄÖåäö.]+\s*(?:\d{4})?)?/ig, "")
    .replace(/\s+/g, " ")
    .trim();

  return clean(stripped) || null;
}

export default async function parse({ html, source }) {
  try {
    const $ = cheerio.load(String(html || ""));
    const rows = [];
    const seen = new Set();

    $('a[href^="/all-events/"]').each((_, el) => {
      const a = $(el);
      const href = clean(a.attr("href"));
      const url = absUrl(href, source?.url || "https://www.gotalejon.se/");
      if (!url) return;

      const title = inferTitle(a);
      const blob = clean(a.text()) || "";
      const start_at = parseSvDate(blob);
      if (!title || !start_at) return;

      const key = `${url}__${start_at}`;
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        title,
        start_at,
        city: source?.city || "Stockholm",
        venue_name: "Göta Lejon",
        description: null,
        image_url: pickImage(a),
        ticket_url: url,
        organizer_url: url,
        source_url: url,
        listing_url: source?.url || null,
        category: source?.category || "teater",
        subcategory: null,
        price_type: "unknown",
      });
    });

    return rows;
  } catch {
    return [];
  }
}

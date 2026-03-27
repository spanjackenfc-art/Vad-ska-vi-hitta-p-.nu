import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  return String(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absUrl(href, base = "https://www.konserthuset.se/") {
  const h = String(href || "").trim();
  if (!h) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

function parseStartFromHref(href) {
  const m = String(href || "").match(/\/(\d{8})-(\d{4})\/?$/);
  if (!m) return null;
  const [, d, t] = m;
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:00+01:00`;
  const dt = new Date(iso);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

export default async function parse({ html, source }) {
  try {
    const $ = cheerio.load(String(html || ""));
    const rows = [];
    const seen = new Set();

    $('a[href^="/program-och-biljetter/kalender/"]').each((_, el) => {
      const a = $(el);
      const href = clean(a.attr("href"));
      const title = clean(a.text());
      if (!href || !title || href === "/program-och-biljetter/kalender/") return;

      const source_url = absUrl(href, source?.url || "https://www.konserthuset.se/");
      const start_at = parseStartFromHref(href);
      if (!source_url || !start_at) return;

      const key = `${source_url}__${start_at}`;
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        title,
        start_at,
        city: source?.city || "Stockholm",
        venue_name: "Konserthuset Stockholm",
        description: null,
        image_url: null,
        ticket_url: source_url,
        organizer_url: source_url,
        source_url,
        listing_url: source?.url || null,
        category: source?.category || null,
        subcategory: null,
        price_type: "unknown",
      });
    });

    return rows;
  } catch {
    return [];
  }
}

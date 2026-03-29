import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x)
    .replace(/&#8211;/g, "–")
    .replace(/&nbsp;/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return s || null;
}

function toAbsUrl(pathOrUrl, base) {
  const v = String(pathOrUrl || "").trim();
  if (!v) return null;
  try {
    return new URL(v, base).toString();
  } catch {
    return null;
  }
}

function parseSvFirstDate(text) {
  const s = String(text || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

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

  const m = s.match(/(\d{1,2})\s+([a-zåäö]+),?\s*(\d{4})/i);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = mon[m[2]];
  const yy = Number(m[3]);
  if (!Number.isFinite(dd) || mm == null || !Number.isFinite(yy)) return null;

  const d = new Date(Date.UTC(yy, mm, dd, 12, 0, 0));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function importOscarsteatern({ html, source }) {
  const $ = cheerio.load(String(html || ""));
  const rows = [];

  $(".show-list .list-card").each((_i, el) => {
    const a = $(el).find("a.list-card__link").first();
    const href = a.attr("href");
    const url = toAbsUrl(href, source?.url || "");

    const image =
      $(el).find(".list-card__image img").attr("src") ||
      $(el).find(".list-card__image img").attr("data-src") ||
      null;

    const title = clean($(el).find("h3.list-card__content__title").first().text());

    const texts = $(el)
      .find("p.list-card__content__text")
      .map((_j, p) => clean($(p).text()))
      .get()
      .filter(Boolean);

    const venue = texts[0] || "Oscarsteatern";
    const start_at = parseSvFirstDate(texts[1] || "");

    if (!title || !url || !start_at) return;

    rows.push({
      title,
      start_at,
      city: source?.city || "Stockholm",
      venue_name: venue,
      description: null,
      image_url: clean(image),
      ticket_url: url,
      organizer_url: url,
      source_url: url,
      listing_url: source?.url || null,
      category: source?.category || "teater",
      subcategory: null,
    });
  });

  const seen = new Set();
  return rows.filter(r => {
    const k = r.source_url || `${r.title}__${r.start_at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

import * as cheerio from "cheerio";

function inferCategoryFromTitle(titleRaw) {
  const t = String(titleRaw || "").toLowerCase();
  if (!t) return "teater";

  // konservativa musical-signaler
  if (t.includes("musikal")) return "musikal";
  if (t.includes("dear evan hansen")) return "musikal";

  return "teater";
}


const MONTHS = {
  jan: 0,
  feb: 1,
  mars: 2,
  apr: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  aug: 7,
  sep: 8,
  okt: 9,
  nov: 10,
  dec: 11,
};

function clean(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseSvDateToken(tok) {
  // Ex: "24 jan, 2026" / "22 mars, 2026"
  const t = clean(tok).toLowerCase().replace(",", "");
  const m = t.match(/^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/i);
  if (!m) return null;

  const day = Number(m[1]);
  const monName = m[2];
  const year = Number(m[3]);

  const mon = MONTHS[monName];
  if (mon === undefined) return null;

  // tid okänd -> lagra som 12:00 UTC för att bevara rätt kalenderdatum utan tidszonsglidning
  return new Date(Date.UTC(year, mon, day, 12, 0, 0)).toISOString();
}

function parseRange(text) {
  // Ex: "24 jan, 2026 – 22 mars, 2026" eller "4 feb, 2026"
  const t = clean(text)
    .replace(/&#8211;|–/g, "–")
    .replace(/\s*–\s*/g, " – ");

  if (t.includes(" – ")) {
    const [a] = t.split(" – ").map(x => x.trim());
    const startISO = parseSvDateToken(a);
    return { startISO, endISO: null, raw: t };
  }

  const startISO = parseSvDateToken(t);
  return { startISO, endISO: null, raw: t };
}

export async function importIntimanForestallningar({ html, source }) {
  const $ = cheerio.load(String(html || ""));

  const items = [];

  $("a.list-card__link").each((_, aEl) => {
    const a = $(aEl);
    const href = clean(a.attr("href")) || null;
    if (!href) return;

    // Hitta närmaste show-kort
    let card = a.closest("li.list-card");
    if (!card.length) card = a.parent();

    const title = clean(card.find("h3.list-card__content__title").first().text()) || null;
    const dateText = (() => {
      const nodes = card.find("p.list-card__content__text").toArray();
      for (const el of nodes) {
        const t = clean(card.find(el).text());
        if (/\d/.test(t)) return t; // datumrad innehåller siffror
      }
      return null;
    })();

    if (!title || !dateText) return;

    const showUrl = href.startsWith("http") ? href : `https://www.intiman.se${href}`;
    const { startISO, endISO, raw } = parseRange(dateText);
    if (!startISO) return;

    const fingerprint = `${source.id}__${showUrl}__${startISO}__intiman_v1`;

    items.push({
      category: inferCategoryFromTitle(title),
      fingerprint,
      title,
      start_at: startISO,
      end_at: endISO,
      city: source.city ?? "Stockholm",
      venue_name: "Intiman",
      ticket_url: showUrl,
      source_url: showUrl,
      description: endISO
        ? `Spelperiod: ${raw}. Tid ej angiven på listningssidan.`
        : `Datum: ${raw}. Tid ej angiven på listningssidan.`,
      price_type: "unknown",
    });
  });

  return items;
}

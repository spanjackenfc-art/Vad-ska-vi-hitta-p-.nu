import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function normalizeVenueDn(raw) {
  const v = clean(raw);
  if (!v) return null;

  // Dela på kommatecken, trimma, dedupe (case-insensitive)
  const parts = v.split(",").map(x => clean(x)).filter(Boolean);

  const normWordDedupe = (seg) => {
    // collapse upprepade ord: "Islandstorget Islandstorget" -> "Islandstorget"
    const words = seg.split(/\s+/).filter(Boolean);
    const out = [];
    for (const w of words) {
      const last = out[out.length - 1];
      if (last && last.toLowerCase() === w.toLowerCase()) continue;
      out.push(w);
    }
    return out.join(" ");
  };

  const seen = new Set();
  const kept = [];
  for (const p of parts) {
    const seg = normWordDedupe(p);
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(seg);
  }

  const joined = kept.join(", ");
  return joined || null;
}


function normalizeDnVenue(vRaw) {
  const v = clean(vRaw);
  if (!v) return null;

  // 1) Dedupe exakta kommateckensegment (case-insensitive)
  const parts = v.split(",").map(p => p.trim()).filter(Boolean);
  const seen = new Set();
  const uniqParts = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqParts.push(p);
  }
  let out = uniqParts.length ? uniqParts.join(", ") : v;

  // 2) Ta bort direkt upprepade ord: "X X" -> "X"
  // Konservativt: endast direkt repetition av samma token
  out = out.replace(/\b([\p{L}0-9.-]+)\s+\1\b/giu, "$1");

  return out;
}

function isLikelyTitle(t) {
  if (!t) return false;
  return /[A-Za-zÅÄÖåäö]/.test(t) && t.length >= 3;
}

function toAbsUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// DN Kalendariet event-länkar slutar ofta med epoch-sekunder (10 siffror)
function extractEpochSeconds(url) {
  if (!url) return null;
  const m = String(url).match(/(\d{10})(?:[^\d]*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export async function importDNKalendariet(source) {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; events-ingestor/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();

  // Tabellrader för events
  $("tr.calendar-table__event").each((_, tr) => {
    const row = $(tr);

    // Titel + länk
    const a = row.find('a[href*="/kalendariet/dn.kalendariet."]').first();
    if (!a.length) return;

    const hrefRaw = a.attr("href");
    const abs = toAbsUrl(hrefRaw, source.url);
    if (!abs) return;

    const epoch = extractEpochSeconds(abs);
    if (!epoch) return;

    const title = clean(a.text());
    if (!isLikelyTitle(title)) return;

    // Beskrivning & plats från tabellcellerna (klasser från sniff)
    const description = clean(row.find("td.calendar-table__description").text());
    const venue = normalizeVenueDn(row.find("td.calendar-table__location").text());

    // Dedup per URL (stabilt för DN)
    if (seen.has(abs)) return;
    seen.add(abs);

    const startISO = new Date(epoch * 1000).toISOString();

    items.push({
      title,
      start_at: startISO,
      ticket_url: null,
      source_url: abs,
      listing_url: source.url,
      description: description,
      venue_name: venue,
      price_type: "unknown",
    });
  });

  items.sort((x, y) => Date.parse(x.start_at) - Date.parse(y.start_at));
  return items;
}

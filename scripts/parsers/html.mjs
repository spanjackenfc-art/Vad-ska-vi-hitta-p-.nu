/**
 * Generic HTML parser (JSON-LD Event)
 * Goal: robust fallback for sites that publish Event schema in <script type="application/ld+json">
 *
 * Interface follows existing parsers: export default async function parse({ ... })
 * We keep it tolerant: return [] on failure.
 */
function arr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

function pickString(v) {
  if (typeof v === "string") return v.trim();
  return "";
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = pickString(v);
    if (s) return s;
  }
  return "";
}

function toISO(dt) {
  // Accept ISO, or something Date can parse; return null if invalid
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function extractJsonLdEvents(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    // Some pages embed multiple JSON objects/arrays; try best-effort parse
    try {
      const json = JSON.parse(raw);
      out.push(...arr(json));
    } catch {
      // try to salvage if multiple JSON blocks are concatenated (rare)
      continue;
    }
  }

  // Flatten @graph
  const flat = [];
  for (const j of out) {
    if (j && typeof j === "object" && j["@graph"]) flat.push(...arr(j["@graph"]));
    else flat.push(j);
  }

  // Filter Event
  return flat.filter((x) => {
    if (!x || typeof x !== "object") return false;
    const t = x["@type"];
    if (Array.isArray(t)) return t.map(String).includes("Event");
    return String(t || "") === "Event";
  });
}

function normalizeEvent(e, source) {
  const title = firstNonEmpty(e.name, e.headline);
  const start_at = toISO(e.startDate || e.start_time || e.start);
  if (!title || !start_at) return null;

  const image = Array.isArray(e.image) ? e.image[0] : e.image;
  const image_url = pickString(image);

  // Location
  const loc = e.location && typeof e.location === "object" ? e.location : null;
  const venue_name = loc ? firstNonEmpty(loc.name, loc["@id"]) : "";

  // URLs
  const event_url = firstNonEmpty(e.url, e["@id"]);
  const offers = e.offers && typeof e.offers === "object" ? e.offers : null;
  const ticket_url = offers ? firstNonEmpty(offers.url, offers["@id"]) : "";

  // Minimal row (align with your existing upsert shape as much as possible)
  return {
    title,
    start_at,
    city: source.city || null,
    venue_name: venue_name || null,
    description: pickString(e.description) || null,
    image_url: image_url || null,
    ticket_url: ticket_url || null,
    organizer_url: null,
    source_url: event_url || source.url || null,
    listing_url: source.url || null,
    category: source.category || null,
    subcategory: null,
  };
}

export default async function parse({ html, source }) {
  try {
    const events = extractJsonLdEvents(html || "");
    const rows = [];
    for (const e of events) {
      const row = normalizeEvent(e, source || {});
      if (row) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

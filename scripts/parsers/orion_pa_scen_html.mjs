import * as cheerio from "cheerio";

function clean(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseISODateLocal(dateStr) {
  // dateStr: "2026-03-25" -> 00:00 lokal tid (Stockholm) => ISO
  const m = clean(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0).toISOString();
}

function parseDotDateLocal(dateStr) {
  // "8.11.2025" -> 00:00 lokal tid (Stockholm) => ISO
  const m = clean(dateStr).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0).toISOString();
}

async function findTicksterUrlOnDetail(absUrl) {
  try {
    const res = await fetch(absUrl);
    if (!res.ok) return null;
    const html = await res.text();
    // snabb regex räcker här
    const m = html.match(/https:\/\/secure\.tickster\.com\/[A-Za-z0-9]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export async function importOrionPaScen(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // På scen-tabben: w-dyn-items med länkar /scen/...
  const pane = $("div.w-tab-pane[data-w-tab='På scen']").first();
  const anchors = (pane.length ? pane : $("body")).find("a.project-link[href^='/scen/']").toArray();
  if (!anchors.length) return [];

  const seen = new Set();
  const items = [];

  for (const aEl of anchors) {
    const a = $(aEl);
    const href = clean(a.attr("href"));
    if (!href) continue;
    const abs = `https://orionteatern.se${href}`;

    // titel
    const title = clean(a.find("h2.heading").first().text()) || null;
    if (!title) continue;

    // datum: YYYY-MM-DD eller fallback D.M.YYYY
    let dateText = null;
    let dotText = null;

    const ps = a.find("p.paragraph.no-margin").toArray().map(el => clean($(el).text()));
    for (const t of ps) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { dateText = t; break; }
      if (!dotText && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(t)) dotText = t;
    }

    const startISO = dateText ? parseISODateLocal(dateText) : (dotText ? parseDotDateLocal(dotText) : null);
    if (!startISO) continue;

    // Skippa passerade datum (vi vill bara ha kommande)
    const t = Date.parse(startISO);
    if (Number.isFinite(t)) {
      const now = Date.now();
      if (t < now - 1000 * 60 * 60 * 24 * 2) continue;
    }

    // dedup på slug+date
    const key = `${href}__${startISO}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // ticket_url: hämta från detaljsida om möjligt
    const ticket = await findTicksterUrlOnDetail(abs);

    const fingerprint = `${source.id}__${abs}__${startISO}__orion_v1`;

    items.push({
      fingerprint,
      title,
      start_at: startISO,
      end_at: null,
      city: source.city ?? "Stockholm",
      venue_name: "Orionteatern",
      ticket_url: ticket || null,
      source_url: abs,
      description: ticket ? "Officiell biljettlänk via Tickster." : "Biljettlänk saknas på detaljsidan vid importtillfället.",
      price_type: "unknown",
    });
  }

  return items;
}

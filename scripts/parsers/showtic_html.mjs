function stripTags(x){ return String(x||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function toISO(x){
  const d=new Date(x);
  if(!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}
function absUrl(base, href){
  const h=String(href||"").trim();
  if(!h) return "";
  if(h.startsWith("http://") || h.startsWith("https://")) return h;
  if(h.startsWith("//")) return "https:" + h;
  try { return new URL(h, base).toString(); } catch { return h; }
}

export default async function parse({ html, source }) {
  try {
    const h = String(html || "");
    const base = source?.url || "https://www.showtic.se";

    // Strategy:
    // 1) find event links on the listing page ("/Evenemang/..." style is common)
    // 2) extract a nearby date if present in the same card/snippet
    // If date missing, we still return row with null start_at? NO - ingestion expects start_at.
    // So we only keep rows where we can parse a date.
    const rows = [];

    // Grab anchors; keep those that look like event pages
    const are = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = are.exec(h))) {
      const href = m[1] || "";
      const text = stripTags(m[2] || "");
      const u = absUrl(base, href);
      if (!u) continue;

      // Heuristic: keep likely event links
      if (!/showtic\.se/i.test(u)) continue;
      if (!/evenemang|event|biljett|tickets|show/i.test(u.toLowerCase())) continue;

      // Look ahead a bit for a date string near the link (within ~600 chars)
      const tail = h.slice(are.lastIndex, are.lastIndex + 900);
      // Common Swedish formats: "2026-02-19", "19/2 2026", "19 feb 2026", "19 februari 2026", "19.02.2026"
      let iso = null;

      let mm;
      mm = tail.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (mm) iso = toISO(`${mm[1]}-${mm[2]}-${mm[3]}T12:00:00Z`);

      if (!iso) {
        mm = tail.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (mm) iso = toISO(`${mm[3]}-${String(mm[2]).padStart(2,"0")}-${String(mm[1]).padStart(2,"0")}T12:00:00Z`);
      }

      if (!iso) {
        mm = tail.match(/(\d{1,2})\/(\d{1,2})\s*(\d{4})/);
        if (mm) iso = toISO(`${mm[3]}-${String(mm[2]).padStart(2,"0")}-${String(mm[1]).padStart(2,"0")}T12:00:00Z`);
      }

      // Month names (sv)
      if (!iso) {
        const mon = {
          jan:"01", feb:"02", mar:"03", apr:"04", maj:"05", jun:"06",
          jul:"07", aug:"08", sep:"09", okt:"10", nov:"11", dec:"12",
          januari:"01", februari:"02", mars:"03", april:"04", juni:"06",
          juli:"07", augusti:"08", september:"09", oktober:"10", november:"11", december:"12"
        };
        mm = tail.toLowerCase().match(/(\d{1,2})\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec|januari|februari|mars|april|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/);
        if (mm) {
          const mo = mon[mm[2]];
          if (mo) iso = toISO(`${mm[3]}-${mo}-${String(mm[1]).padStart(2,"0")}T12:00:00Z`);
        }
      }

      if (!iso) continue; // must have start_at

      const title = text || null;
      if (!title) continue;

      rows.push({
        title,
        start_at: iso,
        city: source?.city || null,
        venue_name: null,
        description: null,
        image_url: null,
        ticket_url: u,
        organizer_url: u,
        source_url: u,
        listing_url: source?.url || null,
        category: source?.category || "musik",
        subcategory: null,
      });
    }

    // de-dupe by ticket_url
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = r.ticket_url || `${r.title}__${r.start_at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

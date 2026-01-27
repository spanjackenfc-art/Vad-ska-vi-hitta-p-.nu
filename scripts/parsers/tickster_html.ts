/**
 * Tickster HTML parser
 * Goal: Extract events from https://www.tickster.com/se/sv/events/in/stockholm
 *
 * Strategy:
 * 1) Parse JSON-LD (Event schema) from the listing page if present.
 * 2) If JSON-LD isn't present or incomplete, fallback:
 *    - collect event detail URLs from anchors
 *    - fetch each detail page and parse JSON-LD there
 *
 * This approach is resilient to markup changes because Tickster (often) exposes Event data via ld+json.
 */

type SourceRow = {
  id: string;
  name: string;
  url: string;
  city: string | null;
  category: string | null;
};

export type ParsedEvent = {
  title: string;
  start_at: string; // ISO string
  end_at?: string | null; // ISO string
  city?: string | null;
  metro_city?: string | null;
  venue_name?: string | null;
  address?: string | null;
  source_url: string; // canonical event URL
  ticket_url?: string | null;
  category?: string | null;
  source_name?: string | null;
};

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function normUrl(u: string, base: string): string {
  try { return new URL(u, base).toString(); } catch { return u; }
}

function pickText(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  return null;
}

function extractJsonLdObjects(html: string): any[] {
  // Extract all <script type="application/ld+json">...</script>
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    const parsed = safeJsonParse(raw);
    if (!parsed) continue;

    // Could be an object, array, or graph container
    if (Array.isArray(parsed)) out.push(...parsed);
    else out.push(parsed);
  }
  return out;
}

function flattenGraph(objs: any[]): any[] {
  const out: any[] = [];
  for (const o of objs) {
    if (!o) continue;
    if (o["@graph"] && Array.isArray(o["@graph"])) out.push(...o["@graph"]);
    else out.push(o);
  }
  return out;
}

function isEventLike(o: any): boolean {
  const t = o?.["@type"];
  if (!t) return false;
  if (typeof t === "string") return t.toLowerCase() === "event";
  if (Array.isArray(t)) return t.map(String).some(x => x.toLowerCase() === "event");
  return false;
}

function parseEventFromJsonLd(o: any, fallbackUrl: string): ParsedEvent | null {
  if (!o) return null;

  const title = pickText(o.name) || pickText(o.headline);
  const start = pickText(o.startDate);
  const end = pickText(o.endDate);

  if (!title || !start) return null;

  // location can be object or string
  let venue: string | null = null;
  let address: string | null = null;
  const loc = o.location;

  if (typeof loc === "string") {
    venue = loc.trim() || null;
  } else if (loc && typeof loc === "object") {
    venue = pickText(loc.name) || null;

    const addr = loc.address;
    if (typeof addr === "string") address = addr.trim() || null;
    else if (addr && typeof addr === "object") {
      // Compose a readable address
      const parts = [
        pickText(addr.streetAddress),
        pickText(addr.postalCode),
        pickText(addr.addressLocality),
        pickText(addr.addressRegion),
        pickText(addr.addressCountry),
      ].filter(Boolean);
      address = parts.length ? parts.join(", ") : null;
    }
  }

  // URL: prefer o.url, else offers.url, else fallbackUrl
  let sourceUrl =
    pickText(o.url) ||
    pickText(o?.mainEntityOfPage) ||
    null;

  // offers could contain ticket url
  let ticketUrl: string | null = null;
  const offers = asArray(o.offers);
  for (const off of offers) {
    const u = pickText(off?.url);
    if (u) { ticketUrl = u; break; }
  }

  // If we still don't have a sourceUrl, use fallback
  sourceUrl = sourceUrl || fallbackUrl;

  return {
    title,
    start_at: new Date(start).toISOString(),
    end_at: end ? new Date(end).toISOString() : null,
    venue_name: venue,
    address,
    source_url: sourceUrl,
    ticket_url: ticketUrl,
  };
}

function extractLikelyEventLinks(html: string, baseUrl: string): string[] {
  // No DOM lib: simple regex for hrefs that look like event pages.
  // We keep it broad and de-dupe.
  const links = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!href) continue;

    // Heuristics: event detail pages often contain "/event" or "/events/"
    const h = href.toLowerCase();
    if (h.includes("/event") || h.includes("/events/") || h.includes("/biljett") || h.includes("/tickets")) {
      links.add(normUrl(href, baseUrl));
    }
  }
  return Array.from(links);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export async function tickster_html(source: SourceRow): Promise<ParsedEvent[]> {
  const listingUrl = source.url;
  const html = await fetchText(listingUrl);

  // 1) Try JSON-LD on listing page
  const rawLd = flattenGraph(extractJsonLdObjects(html));
  const listingEvents = rawLd.filter(isEventLike)
    .map(o => parseEventFromJsonLd(o, listingUrl))
    .filter(Boolean) as ParsedEvent[];

  // If we got a healthy number, trust it
  if (listingEvents.length >= 5) {
    return listingEvents.map(e => ({
      ...e,
      // enforce city/metro_city from source
      city: source.city || "Stockholm",
      metro_city: source.city || "Stockholm",
      category: source.category || "musik",
      source_name: source.name,
      source_url: normUrl(e.source_url, listingUrl),
      ticket_url: e.ticket_url ? normUrl(e.ticket_url, listingUrl) : null,
    }));
  }

  // 2) Fallback: find event links, fetch each, parse JSON-LD there
  const links = extractLikelyEventLinks(html, listingUrl);

  // Keep it reasonable so we don't DDOS ourselves on first run
  const unique = Array.from(new Set(links)).slice(0, 60);

  const out: ParsedEvent[] = [];
  for (const url of unique) {
    try {
      const detailHtml = await fetchText(url);
      const ld = flattenGraph(extractJsonLdObjects(detailHtml));
      const evtObj = ld.find(isEventLike);
      const parsed = evtObj ? parseEventFromJsonLd(evtObj, url) : null;
      if (!parsed) continue;

      out.push({
        ...parsed,
        city: source.city || "Stockholm",
        metro_city: source.city || "Stockholm",
        category: source.category || "musik",
        source_name: source.name,
        source_url: normUrl(parsed.source_url, url),
        ticket_url: parsed.ticket_url ? normUrl(parsed.ticket_url, url) : null,
      });
    } catch {
      // ignore single failures
    }
  }

  // De-dupe by (title + start_at + source_url)
  const dedup = new Map<string, ParsedEvent>();
  for (const e of out) {
    const k = `${e.title}__${e.start_at}__${e.source_url}`;
    if (!dedup.has(k)) dedup.set(k, e);
  }
  return Array.from(dedup.values());
}

/**
 * Ticketmaster Discovery API stub
 * - Fetch 1 page
 * - Log counts
 * - Do NOT upsert anything yet (returns 0)
 *
 * Env:
 *  - TICKETMASTER_API_KEY
 */
export async function importTicketmasterApi(source) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error("Missing TICKETMASTER_API_KEY");

  // Minimal, safe request: 1 item, page 0, Sweden only
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "SE");
  url.searchParams.set("size", "1");
  url.searchParams.set("page", "0");

  // NOTE: We don't rely on source.url here yet; later we can store base params/config in sources.url.
  const res = await fetch(url.toString(), {
    headers: { "accept": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ticketmaster API failed: ${res.status} ${res.statusText}${body ? ` :: ${body.slice(0, 200)}` : ""}`);
  }

  const json = await res.json();

  const page = json?.page || {};
  const totalElements = Number(page?.totalElements ?? NaN);
  const number = Number(page?.number ?? NaN);
  const size = Number(page?.size ?? NaN);

  const embedded = json?._embedded || {};
  const events = Array.isArray(embedded?.events) ? embedded.events : [];

  console.log("[TICKETMASTER_API_STUB]", {
    source: { id: source?.id, name: source?.name, parser: source?.parser, kind: source?.kind },
    request: { countryCode: "SE", page: 0, size: 1 },
    page: { totalElements, number, size },
    returnedEvents: events.length,
  });

  return 0;
}

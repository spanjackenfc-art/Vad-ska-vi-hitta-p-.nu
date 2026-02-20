/**
 * Ticketmaster Discovery API → return normalized items
 *
 * Returns: Array<{ title, start_at, end_at?, city?, venue_name?, ticket_url?, source_url?, image_url?, price_min?, price_max? }>
 */

export async function importTicketmasterApi(source) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error("Missing TICKETMASTER_API_KEY");

  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "SE");
  url.searchParams.set("classificationName", "family");
  url.searchParams.set("size", "20");
  url.searchParams.set("page", "0");

  const res = await fetch(url.toString(), {
    headers: { "accept": "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("Ticketmaster API failed: " + res.status + " " + res.statusText + (body ? " :: " + body.slice(0, 200) : ""));
  }

  const json = await res.json();
  const events = json?._embedded?.events || [];

  const items = events.map(ev => {
    const startISO = ev?.dates?.start?.dateTime || null;
    const endISO = ev?.dates?.end?.dateTime || null;

    const venue = ev?._embedded?.venues?.[0];
    const city = venue?.city?.name || null;
    const venueName = venue?.name || null;

    const ticketUrl = ev?.url || null;

    const image = Array.isArray(ev?.images)
      ? ev.images
          .sort((a,b) => (b.width || 0) - (a.width || 0))[0]?.url || null
      : null;

    const priceMin = ev?.priceRanges?.[0]?.min ?? null;
    const priceMax = ev?.priceRanges?.[0]?.max ?? null;

    return {
      title: ev?.name || "Untitled event",
      start_at: startISO,
      end_at: endISO,
      city,
      venue_name: venueName,
      ticket_url: ticketUrl,
      source_url: ticketUrl,
      image_url: image,
      price_min: priceMin,
      price_max: priceMax,
      price_type: priceMin === 0 ? "free" : (priceMin != null ? "paid" : "unknown"),
    };
  });

  console.log("[TICKETMASTER_API]", {
    source: source?.name,
    returned: items.length,
  });

  return items;
}

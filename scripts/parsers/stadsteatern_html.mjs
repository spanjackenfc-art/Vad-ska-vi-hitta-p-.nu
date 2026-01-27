export async function importStadsteatern(source) {
  const api = "https://elastic.kulturhusetstadsteatern.se/khst-events";

  const res = await fetch(api, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Stadsteatern API ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const hits = (json && json.hits && Array.isArray(json.hits.hits)) ? json.hits.hits : [];

  const out = [];

  for (const h of hits) {
    const e = h && h._source ? h._source : null;
    if (!e) continue;

    const title = (e.title || "").trim();
    if (!title) continue;

    const startRaw = e.start_date || e.startDate || e.start || null;
    if (!startRaw) continue;

    const startMs = Date.parse(startRaw);
    if (!Number.isFinite(startMs)) continue;

    const endRaw = e.end_date || e.endDate || e.end || null;
    const endMs = endRaw ? Date.parse(endRaw) : NaN;

    const detailsUrl = (e.url || e.permalink || e.details_url || "").trim();
    const ticketUrl = (e.ticket_url || e.ticketUrl || e.booking_url || "").trim();

    out.push({
      title,
      description: (e.description || e.preamble || e.summary || null),
      start_at: new Date(startMs).toISOString(),
      end_at: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
      venue_name: (e.venue_name || e.venue || "Kulturhuset Stadsteatern"),
      city: (source && source.city) ? source.city : "Stockholm",
      ticket_url: ticketUrl || detailsUrl || null,
      source_url: detailsUrl || (source ? source.url : api),
      image_url: (e.image_url || e.image || e.imageUrl || null),
      category: (source && source.category) ? source.category : "teater",
    });
  }

  return out;
}

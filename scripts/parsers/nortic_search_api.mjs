function clean(x) {
  const s = String(x || "").replace(/\s+/g, " ").trim();
  return s || null;
}

function stripTags(x) {
  return clean(String(x || "").replace(/<[^>]+>/g, " "));
}

function toLocalIsoLike(s) {
  const v = clean(s);
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return v.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return v.replace(" ", "T") + ":00";
  return null;
}

function eventUrl(id) {
  const v = clean(id);
  return v ? `https://nortic.se/ticket/event/${v}` : null;
}

function organizerUrl(id) {
  const v = clean(id);
  return v ? `https://nortic.se/ticket/organizer/${v}` : null;
}

async function fetchSearchPage(query, offset) {
  const url = new URL("https://tvw5qfkstj.execute-api.eu-north-1.amazonaws.com/prod/search-event");
  url.searchParams.set("search", query);
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "application/json,text/plain,*/*"
    }
  });

  if (!res.ok) {
    throw new Error(`Nortic search API failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return Array.isArray(json?.events) ? json.events : [];
}

export default async function parse(source) {
  try {
    const rows = [];
    const seen = new Set();
    const query = "a";

    for (let offset = 0; offset <= 1000; offset += 25) {
      const events = await fetchSearchPage(query, offset);

      for (const ev of events) {
        const id = clean(ev?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const start_at = toLocalIsoLike(ev?.first_date);
        const end_at = toLocalIsoLike(ev?.last_date);
        const ticket_url = eventUrl(id);

        if (!start_at || !ticket_url) continue;

        rows.push({
          title: clean(ev?.name) || "Untitled event",
          start_at,
          end_at,
          city: clean(ev?.city),
          venue_name: clean(ev?.venue) || clean(ev?.organizer_name),
          description: clean(ev?.short_information) || stripTags(ev?.information),
          image_url: null,
          ticket_url,
          organizer_url: organizerUrl(ev?.organizer_id),
          source_url: ticket_url,
          listing_url: source?.url || null,
          category: source?.category || null,
          subcategory: clean(ev?.event_category)?.toLowerCase() || null,
        });
      }

      if (events.length < 25) break;
    }

    console.log("[NORTIC_SEARCH_API]", {
      source: source?.name,
      query,
      returned: rows.length,
    });

    return rows;
  } catch (e) {
    console.log("[NORTIC_SEARCH_API]", {
      source: source?.name,
      error: e?.message || String(e),
    });
    return [];
  }
}

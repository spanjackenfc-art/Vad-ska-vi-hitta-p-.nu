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

function topLevelCategoryFromNortic(subRaw) {
  const sub = clean(subRaw)?.toLowerCase() || null;
  if (!sub) return null;

  if (sub === "konsert") return "musik";
  if (sub === "dans") return "dans";

  if ([
    "teater",
    "show",
    "humor",
    "barnteater",
    "föreställning",
    "forestallning",
    "cirkus",
    "musikal",
    "opera",
    "revy",
    "spex",
    "kultursoppa"
  ].includes(sub)) return "teater";

  if ([
    "festival",
    "guidad visning",
    "föredrag",
    "sport",
    "nattklubb",
    "entré",
    "entre",
    "resebiljetter",
    "bio",
    "film",
    "motor",
    "mässa",
    "massa",
    "övrigt",
    "ovrigt"
  ].includes(sub)) return "ovrigt";

  return null;
}

function normalizeCity(v) {
  const c = clean(v);
  if (!c) return null;
  const low = c.toLowerCase();
  if (low === "00000" || low === "-" || /^\d+$/.test(c)) return null;
  return c;
}

function normalizeSubcategory(v) {
  const sub = clean(v)?.toLowerCase() || null;
  if (!sub) return null;
  if (sub === "övrigt" || sub === "ovrigt") return null;
  return sub;
}

function allowSubcategory(sub) {
  const v = String(sub || "").toLowerCase();
  return [
    "konsert",
    "teater",
    "show",
    "humor",
    "barnteater",
    "dans",
    "musikal",
    "cirkus",
    "opera",
    "föreställning",
    "forestallning",
    "festival",
    "revy"
  ].includes(v);
}

function topCategoryFromSubcategory(sub) {
  const v = String(sub || "").toLowerCase();

  if (v === "konsert") return "musik";

  if ([
    "teater",
    "show",
    "humor",
    "barnteater",
    "dans",
    "musikal",
    "föreställning",
    "forestallning",
    "cirkus",
    "opera",
    "revy"
  ].includes(v)) return "teater";

  if ([
    "festival"
  ].includes(v)) return "ovrigt";

  return null;
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
        const subcategory = normalizeSubcategory(ev?.event_category);

        if (!start_at || !ticket_url || !allowSubcategory(subcategory)) continue;

        rows.push({
          title: clean(ev?.name) || "Untitled event",
          start_at,
          end_at,
          city: normalizeCity(ev?.city),
          venue_name: clean(ev?.venue) || clean(ev?.organizer_name),
          description: clean(ev?.short_information) || stripTags(ev?.information),
          image_url: null,
          ticket_url,
          organizer_url: organizerUrl(ev?.organizer_id),
          source_url: ticket_url,
          listing_url: source?.url || null,
          category: source?.category || topCategoryFromSubcategory(subcategory) || null,
          subcategory,
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

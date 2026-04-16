/**
 * Ticketmaster Discovery API → return normalized items
 *
 * Returns:
 * Array<{ title, start_at, end_at?, city?, venue_name?, ticket_url?, source_url?, image_url?, price_min?, price_max? }>
 */

function shouldIncludeTicketmasterEvent(ev) {
  const title = String(ev?.name || "").trim();
  const t = title.toLowerCase();

  if (!title) return false;

  // Drop obvious junk/test/internal
  const junk = ["do not purchase", "do not purchases", "test", "qa", "dummy", "internal"];
  if (junk.some(x => t.includes(x))) return false;

  // Require a usable future date
  const startISO = ev?.dates?.start?.dateTime || null;
  if (!startISO) return false;

  const startMs = Date.parse(startISO);
  if (!Number.isFinite(startMs)) return false;
  if (startMs < Date.now()) return false;

  return true;
}

function mapTicketmasterClassification(ev) {
  const c = ev?.classifications?.[0] || {};
  const segment = String(c?.segment?.name || "").toLowerCase();
  const genre = String(c?.genre?.name || "").toLowerCase();
  const subGenre = String(c?.subGenre?.name || "").toLowerCase();
  const type = String(c?.type?.name || "").toLowerCase();
  const subType = String(c?.subType?.name || "").toLowerCase();
  const blob = [segment, genre, subGenre, type, subType].join(" ");

  if (segment === "music") {
    return { category: "musik", subcategory: "konsert" };
  }

  if (segment === "arts & theatre") {
    if (genre === "comedy" || subGenre === "comedy") {
      return { category: "standup", subcategory: "standup" };
    }

    if (genre === "dance" || subGenre === "dance") {
      return { category: "teater", subcategory: "dans" };
    }

    if (subGenre === "musical" || /\bmusical\b/.test(blob)) {
      return { category: "teater", subcategory: "musikal" };
    }

    if (genre === "theatre") {
      return { category: "teater", subcategory: "teater" };
    }
  }

  if (segment === "miscellaneous") {
    if (genre === "fairs & festivals" || subGenre === "fairs & festivals") {
      return { category: "ovrigt", subcategory: "festival" };
    }
  }

  return { category: null, subcategory: null };
}

async function fetchTicketmasterPage({ apiKey, page, size, startDateTime }) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("countryCode", "SE");
  url.searchParams.set("size", String(size));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("startDateTime", startDateTime);

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      "Ticketmaster API failed: " +
        res.status +
        " " +
        res.statusText +
        (body ? " :: " + body.slice(0, 300) : "")
    );
  }

  return await res.json();
}

export async function importTicketmasterApi(source) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error("Missing TICKETMASTER_API_KEY");

  const size = 200;
  const startDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const first = await fetchTicketmasterPage({
    apiKey,
    page: 0,
    size,
    startDateTime,
  });

  const totalPagesRaw = Number(first?.page?.totalPages || 0);
  const totalPages = Math.max(1, Math.min(totalPagesRaw, 50));

  const raw = [];
  raw.push(...(first?._embedded?.events || []));

  for (let page = 1; page < totalPages; page++) {
    const json = await fetchTicketmasterPage({
      apiKey,
      page,
      size,
      startDateTime,
    });
    raw.push(...(json?._embedded?.events || []));
  }

  const seen = new Set();
  const events = raw.filter(ev => {
    if (!shouldIncludeTicketmasterEvent(ev)) return false;

    const key =
      ev?.id ||
      ev?.url ||
      `${String(ev?.name || "").trim()}__${String(ev?.dates?.start?.dateTime || "").trim()}`;

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });

  const items = events.map(ev => {
    const startISO = ev?.dates?.start?.dateTime || null;
    const endISO = ev?.dates?.end?.dateTime || null;

    const venue = ev?._embedded?.venues?.[0];
    const city = venue?.city?.name || null;
    const venueName = venue?.name || null;

    const ticketUrl = ev?.url || null;

    const image = Array.isArray(ev?.images)
      ? ev.images.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null
      : null;

    const priceMin = ev?.priceRanges?.[0]?.min ?? null;
    const priceMax = ev?.priceRanges?.[0]?.max ?? null;
    const mapped = mapTicketmasterClassification(ev);

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
      category: mapped.category,
      subcategory: mapped.subcategory,
    };
  });

  console.log("[TICKETMASTER_API]", {
    source: source?.name,
    totalPages,
    rawReturned: raw.length,
    filteredReturned: items.length,
  });

  return items;
}

import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

function parseJsonAttr(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return null;

  const attempts = [
    s0,
    s0.replace(/&quot;/g, '"'),
    s0.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  ];

  for (const s of attempts) {
    try {
      return JSON.parse(s);
    } catch {}
  }

  return null;
}

function inferCity(source) {
  const city = clean(source?.city);
  if (city) return city;

  const u = String(source?.url || "").toLowerCase();
  if (u.includes("/stockholm/")) return "Stockholm";
  if (u.includes("/goteborg/")) return "Göteborg";
  if (u.includes("/malmo/")) return "Malmö";

  return null;
}

function pickImageUrl(item) {
  return clean(
    item?.teaserImage?.styles?.teaserLargeHidpi ||
    item?.teaserImage?.styles?.teaserLarge ||
    item?.teaserImage?.styles?.teaserHidpi ||
    item?.teaserImage?.styles?.teaser ||
    null
  );
}

function toISODateNoon(raw) {
  const s = clean(raw);
  if (!s) return null;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  return new Date(Date.UTC(y, mo, d, 12, 0, 0)).toISOString();
}

function detailUrlFor(eventBase, item) {
  const slug = clean(item?.slug);
  if (!slug) return null;

  try {
    const base = clean(eventBase) || "https://www.barnistan.se/tips/evenemang/";
    return new URL(slug.replace(/^\/+|\/+$/g, "") + "/", base).toString();
  } catch {
    return null;
  }
}

function parseRootConfig(html) {
  const $ = cheerio.load(String(html || ""));
  const root = $("#search-root").first();
  if (!root.length) return { rootLocation: null, eventBase: null };

  const cfg = parseJsonAttr(root.attr("data-config"));
  return {
    rootLocation: clean(cfg?.rootLocation),
    eventBase: clean(cfg?.rewrites?.event) || "https://www.barnistan.se/tips/evenemang/",
  };
}

async function fetchSearchPage(rootLocation, offset, location) {
  const url = new URL("https://www.barnistan.se/api/search");
  url.searchParams.set("type", "event");
  url.searchParams.set("rootLocation", rootLocation);
  url.searchParams.set("offset", String(offset));
  if (location) url.searchParams.set("location", location);

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept": "application/json,text/plain,*/*",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Barnistan API failed: ${res.status} ${res.statusText}`);
  }

  return await res.json();
}

export async function importBarnistan({ html: _html, source }) {
  const { rootLocation, eventBase } = parseRootConfig(_html);

  if (!rootLocation) {
    throw new Error("Barnistan rootLocation missing");
  }

  const city = null;
  const out = [];
  const seenIds = new Set();
  const pageSize = 18;
  let totalItemCount = null;

  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await fetchSearchPage(rootLocation, offset, null);
    const items = Array.isArray(page?.items) ? page.items : [];

    if (Number.isFinite(Number(page?.totalItemCount))) {
      totalItemCount = Number(page.totalItemCount);
    }

    if (!items.length) break;

    let newIdsThisPage = 0;

    for (const item of items) {
      const id = clean(item?.id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      newIdsThisPage += 1;

      const start_at = toISODateNoon(item?.eventDates?.start);
      const end_at = toISODateNoon(item?.eventDates?.end);

      if (!start_at) continue;

      const source_url = detailUrlFor(eventBase, item) || source?.url || null;

      out.push({
        title: clean(item?.name) || "Untitled event",
        description: clean(item?.description),
        start_at,
        end_at,
        city,
        venue_name: clean(item?.destinationName),
        ticket_url: null,
        organizer_url: null,
        source_url,
        listing_url: clean(source?.url),
        image_url: pickImageUrl(item),
        category: clean(source?.category) || null,
        subcategory: null,
        audience: "familj",
        price_type:
          item?.isFreeOfCharge === true ? "free" :
          item?.isFreeOfCharge === false ? "paid" :
          "unknown",
        price_min: null,
        price_max: null,
      });
    }

    if (newIdsThisPage === 0) break;
    if (items.length < pageSize) break;
    if (totalItemCount != null && seenIds.size >= totalItemCount) break;
  }

  return out;
}

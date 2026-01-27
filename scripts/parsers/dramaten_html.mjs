import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function toAbsUrl(pathOrUrl, base) {
  const v = String(pathOrUrl || "").trim();
  if (!v) return null;
  try { return new URL(v, base).toString(); } catch { return null; }
}

function guessCategory(source, perf) {
  // Prefer source.category, else infer from Dramaten categories
  const sc = clean(source?.category);
  if (sc) return sc;

  const cats = perf?.production?.categories || [];
  const slugs = Array.isArray(cats) ? cats.map(c => String(c?.slug || "").toLowerCase()) : [];

  if (slugs.some(s => s.includes("barn") || s.includes("unga"))) return "familj";
  return "teater";
}

export async function importDramaten(source) {
  // Use kalendarium because it contains showtimes with startDate + purchaseUrl.
  const url = "https://www.dramaten.se/kalendarium";
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Dramaten fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const $ = cheerio.load(html);
  const j = $("#__NEXT_DATA__").text();
  if (!j) throw new Error("Dramaten kalendarium: missing __NEXT_DATA__");

  const data = JSON.parse(j);
  const items = data?.props?.pageProps?.content?.performances?.items || [];
  if (!Array.isArray(items)) throw new Error("Dramaten kalendarium: performances.items not array");

  const out = [];
  for (const day of items) {
    const perfs = Array.isArray(day?.performances) ? day.performances : [];
    for (const p of perfs) {
      const title = clean(p?.title) || clean(p?.production?.title);
      const startTs = p?.startDateTimestamp;
      const startIso = Number.isFinite(startTs) ? new Date(startTs).toISOString() : null;
      if (!title || !startIso) continue;

      const purchaseUrl = toAbsUrl(p?.purchaseUrl, "https://www.dramaten.se");
      const prodUrl = toAbsUrl(p?.production?.url, "https://www.dramaten.se");
      const img = clean(p?.production?.listingImage?.url) || clean(p?.production?.posterImage?.url) || null;
      const venue = clean(p?.venue?.name) || clean(p?.production?.location) || "Dramaten";

      const desc = clean(p?.production?.description) || clean(p?.extraInformation) || null;

      out.push({
        title,
        description: desc,
        start_at: startIso,
        end_at: null,
        city: clean(source?.city) || "Stockholm",
        venue_name: venue,
        ticket_url: prodUrl || purchaseUrl,
        source_url: prodUrl || purchaseUrl || url,
        organizer_url: prodUrl || null,
        image_url: img,
        category: guessCategory(source, p),
        price_type: "unknown",
      });
    }
  }

  return out;
}

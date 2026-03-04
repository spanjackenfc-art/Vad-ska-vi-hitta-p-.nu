import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function normalizeVenueDn(raw) {
  const v = clean(raw);
  if (!v) return null;

  const parts = v.split(",").map(x => clean(x)).filter(Boolean);

  const normWordDedupe = (seg) => {
    const words = seg.split(/\s+/).filter(Boolean);
    const out = [];
    for (const w of words) {
      const last = out[out.length - 1];
      if (last && last.toLowerCase() === w.toLowerCase()) continue;
      out.push(w);
    }
    return out.join(" ");
  };

  const seen = new Set();
  const kept = [];
  for (const p of parts) {
    const seg = normWordDedupe(p);
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(seg);
  }

  const joined = kept.join(", ");
  return joined || null;
}

function isLikelyTitle(t) {
  if (!t) return false;
  return /[A-Za-zÅÄÖåäö]/.test(t) && t.length >= 3;
}

function toAbsUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// DN Kalendariet event-länkar slutar ofta med epoch-sekunder (10 siffror)
function extractEpochSeconds(url) {
  if (!url) return null;
  const m = String(url).match(/(\d{10})(?:[^\d]*)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isBadExternalUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.startsWith("mailto:")) return true;
  if (lower.startsWith("webcal:")) return true;
  if (lower.startsWith("data:")) return true;
  if (lower.startsWith("javascript:")) return true;

  try {
    const url = new URL(s);
    const proto = url.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return true;

    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    // aldrig DN/Bonnier som "official"
    if (host.endsWith("dn.se")) return true;
    if (host.endsWith("konto.bonniernews.se")) return true;
    if (host.endsWith("bonniernews.se")) return true;

    // social/share
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return true;
    if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com") || host.endsWith(".x.com")) return true;
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return true;

    // calendar/ics
    if (host.endsWith("calendar.google.com")) return true;
    if ((url.pathname || "").toLowerCase().endsWith(".ics")) return true;

    const path = (url.pathname || "").toLowerCase();
    if (path.includes("/share") || path.includes("/sharer.php") || path.includes("/intent/")) return true;
    if (url.searchParams.has("share") || url.searchParams.has("shared")) return true;

    return false;
  } catch {
    return true;
  }
}

function scoreCta(urlStr, textRaw) {
  const text = (textRaw ?? "").toLowerCase();
  let score = 0;

  if (text.includes("biljett")) score += 60;
  if (text.includes("köp")) score += 40;
  if (text.includes("boka")) score += 35;
  if (text.includes("tickets")) score += 30;
  if (text.includes("bokning")) score += 25;

  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname || "").toLowerCase();

    const goodHosts = [
      "tickster.com",
      "nortic.se",
      "ticketmaster.se",
      "billetto.se",
      "eventim.se",
      "showtic.se",
      "kulturbiljetter.se",
      "ticketco.events",
      "transticket.se",
      "axs.com",
      "tixly.com",
    ];
    if (goodHosts.some(h => host === h || host.endsWith("." + h))) score += 40;

    if (path.includes("biljett") || path.includes("ticket") || path.includes("buy") || path.includes("bok")) score += 15;
  } catch {
    // ignore
  }

  return score;
}

async function fetchDnDetailCta(detailUrl) {
  if (!detailUrl) return null;

  const res = await fetch(detailUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; events-ingestor/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  const cands = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    const abs = toAbsUrl(href, detailUrl);
    if (!abs) return;
    if (!abs.startsWith("http")) return;
    if (isBadExternalUrl(abs)) return;

    const text = clean($(a).text()) || "";
    const score = scoreCta(abs, text);
    if (score <= 0) return;

    cands.push({ url: abs, score });
  });

  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.url || null;
}

export async function importDNKalendariet(source) {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; events-ingestor/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();

  $("tr.calendar-table__event").each((_, tr) => {
    const row = $(tr);

    const a = row.find('a[href*="/kalendariet/dn.kalendariet."]').first();
    if (!a.length) return;

    const hrefRaw = a.attr("href");
    const abs = toAbsUrl(hrefRaw, source.url);
    if (!abs) return;

    const epoch = extractEpochSeconds(abs);
    if (!epoch) return;

    const title = clean(a.text());
    if (!isLikelyTitle(title)) return;

    const description = clean(row.find("td.calendar-table__description").text());
    const venue = normalizeVenueDn(row.find("td.calendar-table__location").text());

    if (seen.has(abs)) return;
    seen.add(abs);

    const startISO = new Date(epoch * 1000).toISOString();

    items.push({
      title,
      start_at: startISO,
      end_at: null,
      venue_name: venue,
      description: description,
      price_type: "unknown",
      price_min: null,
      price_max: null,

      // DN
      source_url: abs,
      details_url: abs,
      listing_url: source.url,

      // enriched later
      ticket_url: null,
    });
  });

  items.sort((x, y) => Date.parse(x.start_at) - Date.parse(y.start_at));

  // Enrich: försök hitta extern CTA på detaljsidan
  for (const it of items) {
    if (it.ticket_url) continue;
    const u = it.details_url || it.source_url;
    if (!u) continue;
    try {
      const cta = await fetchDnDetailCta(u);
      if (cta) it.ticket_url = cta;
    } catch {
      // ignore
    }
  }

  return items;
}

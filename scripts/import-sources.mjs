import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config({ path: ".env.local" });

import ical from "ical";
import * as cheerio from "cheerio";
import { HTML_PARSERS } from "./parsers/router.mjs";
import { importTickster } from "./parsers/tickster_html.mjs";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function clean(x) {
  if (!x) return null;
  return String(x).trim().replace(/\s+/g, " ");
}

function normalizeVenue(value) {
  const v = clean(value);
  if (!v) return null;

  // Matcha lat,lng eller "lat lng" med decimaltal
  const coordLike = /^\s*-?\d{1,2}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+\s*$/;
  if (coordLike.test(v)) return null;

  // Om texten är "för numerisk" (ex: bara siffror/kommatecken/punkt)
  const onlyNumPunct = /^[\d\s,.\-]+$/.test(v);
  if (onlyNumPunct && v.replace(/[\s,.\-]/g, "").length >= 6) return null;

  return v;
}

function normalizeTitleForKey(t) {
  return String(t || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9åäö\s\-]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferAudience({ source, it }) {
  const sc = String(source?.category || "").trim().toLowerCase();
  const sn = String(source?.name || "").trim().toLowerCase();

  // SUBCATEGORY AUDIENCE: if upstream provided "Barn/Familj" etc, treat as family audience
  const subRaw = String(it?.subcategory || "");
  if (/barn|familj/i.test(subRaw)) return "familj";

  // HARD RULE: family-first sources are family audience
  if (sc === "familj") return "familj";

  // Build a robust text blob from multiple optional fields
  const t = String(it?.title || "").toLowerCase();
  const v = String(it?.venue_name || "").toLowerCase();
  const d1 = String(it?.description || "").toLowerCase();

  // Some parsers may use description_text/subcategory even if not in type; be defensive
  const d2 = String(it?.description_text || "").toLowerCase();
  
  const sub = subRaw.toLowerCase();
  if (/\b(barn|familj)\b/i.test(subRaw)) return "familj";

  const blob = [t, v, d1, d2, sub, sn].join(" ");

  // Strong family signals
  if (/(\bbarn\b|\bfamilj\b|\bbarn\s*och\s*familj\b)/i.test(blob)) return "familj";
  // NOTE: "skola/förskola/fritids" alone is too broad (adult talks can mention school).
  // Require child-context before classifying as familj.
  if (/\b(förskola|forskola|skola|fritids)\b/i.test(blob)) {
    if (/\b(barn|familj)\b/i.test(blob)) return "familj";
    if (/\b(för\s*barn|barnteater)\b/i.test(blob)) return "familj";
  }
  if (/\bfrån\s*\d{1,2}\s*år\b/i.test(blob)) return "familj";
  if (/\b\d{1,2}\s*[–-]\s*\d{1,2}\s*år\b/i.test(blob)) return "familj";
  if (/\b(0\s*[–-]\s*3|3\s*[–-]\s*6|4\s*[–-]\s*8|6\s*[–-]\s*12)\b/i.test(blob)) return "familj";

  // Title-keywords: strong family brands/acts (keep list short + high-signal)
  if (/\b(arne\s+alligator|pappa\s+kapsyl|babblarna|bolibompa|bamse|alfons|pettson|findus|pippi|mamma\s+mu)\b/i.test(blob)) return "familj";
  // Generic high-signal
  if (/\bbarnteater\b/i.test(blob)) return "familj";

  return null;
}

function categoryFromSubcategory(subRaw) {
  const sub = String(subRaw || "").toLowerCase().trim();
  if (!sub) return null;
  if (sub === "konsert") return "musik";
  if (sub === "visning" || sub === "workshop") return "ovrigt";
  if (sub === "opera" || sub === "musikal" || sub === "dans") return "teater";
  return null;
}

function inferSubcategory({ source, it }) {
  const sn = String(source?.name || "").toLowerCase();
  const title = String(it?.title || "").toLowerCase();
  const venue = String(it?.venue_name || "").toLowerCase();
  const blob = [sn, title, venue].join(" ");

  if (/\b(visning|guidad\s*visning)\b/i.test(blob)) return "visning";
  if (/\b(workshop|kurs|helgkurs|föredrag|foredrag|prova\s*på|lär\s*dig|lar\s*dig|binderi|keramik|broderi|måleri|maleri|teckning|collage|markram[eé])\b/i.test(blob)) return "workshop";
  if (/\b(workshop|prova\s*på|föreläsning)\b/i.test(blob)) return "workshop";
  if (/\b(konsert|kammarkonsert|recital|live)\b/i.test(blob)) return "konsert";
  if (/\b(dans|ballet|balett)\b/i.test(blob)) return "dans";
  if (/\bmusikal\b/i.test(blob)) return "musikal";

// Malmö Opera: deterministic via source_id (avoid brittle title/locale issues)
  if (String(source?.id || "") === "d91f0618-513b-4729-8454-67ea655e31a7") {
    if (/\b(visning|guidad\s*visning)\b/i.test(blob)) return "visning";
      if (/\b(kammar|kammarkonsert|konsert|recital|live)\b/i.test(blob)) return "konsert";
    if (/\bmusikal\b/i.test(blob)) return "musikal";
    if (/\b(dans|balett|ballet)\b/i.test(blob)) return "dans";
    return "opera";
  }

  return null;
}

function inferGenreCategory({ source, it }) {
  // If parser already set category, keep it.
  const c0 = String(it?.category || "").trim().toLowerCase();
  if (c0) return c0;


  const sub = inferSubcategory({ source, it });
  if (sub === "konsert") return "musik";
  if (sub === "visning" || sub === "workshop") return "ovrigt";
  if (sub === "standup") return "standup";
  if (sub === "dans" || sub === "opera" || sub === "musikal") return "teater";

  const title = String(it?.title || "").toLowerCase();
  const venue = String(it?.venue_name || "").toLowerCase();
  const srcName = String(source?.name || "").toLowerCase();
  const blob = [title, venue, srcName].join(" ");

  // Standup
  if (/\b(standup|stand-up|comedy|humor)\b/i.test(blob)) return "standup";

  // Music / concert
  if (/\b(konsert|live|gig|orkester|recital|kammarkonsert)\b/i.test(blob)) return "musik";

  // Workshops / tours / misc
  if (/\b(guidad\s*visning|visning|workshop|prova\s*på|föreläsning|utställning)\b/i.test(blob)) return "ovrigt";

  // Theatre family default
  const sc = String(source?.category || "").toLowerCase();
  return sc || "ovrigt";
}

function sourceRank(source) {
const p = String(source?.parser || "").toLowerCase();
  if (p === "dramaten_html") return 100;
  if (p === "oscarsteatern_html") return 95;
  if (p === "chinateatern_html") return 95;
  if (p === "folkoperan_html") return 90;
  if (p === "o2scenkonst_html") return 85;
  if (p === "musikal_html") return 80;
  if (p === "tickster_html") return 60;
  if (p === "welma_html") return 40;
  if (p === "dn_kalendariet") return 30;
  if (p === "barnistan_html") return 20;
  return 10;
}

function canonicalKeyFor({ title, startISO, city }) {
  const t = normalizeTitleForKey(title);
  const c = String(city || "").toLowerCase().trim();
  return `${t}__${startISO.slice(0,10)}__${c}`;
}


// EVENT_IMAGES_CACHE_V1
const EVENT_IMAGES_BUCKET = "event-images";

// EVENT_IMAGES_CACHE_STATS_V1
let IMG_CACHE_ATTEMPTS = 0;
let IMG_CACHE_SUCCESS = 0;
let IMG_CACHE_FAIL = 0;
const IMG_CACHE_FAIL_BY = new Map();
function bumpFail(key) {
  const k = String(key || "unknown").slice(0, 80);
  IMG_CACHE_FAIL_BY.set(k, (IMG_CACHE_FAIL_BY.get(k) || 0) + 1);
}

function storagePublicPrefix() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/${EVENT_IMAGES_BUCKET}/` : "";
}

function isAlreadyCachedUrl(u) {
  try {
    const pref = storagePublicPrefix();
    return !!pref && typeof u === "string" && u.startsWith(pref);
  } catch {
    return false;
  }
}

function decodeHtmlEntities(input) {
  const s = String(input || "");
  // numeric decimal: &#229;  | numeric hex: &#xE5;
  return s.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extFromUrl(u) {
  try {
    const pathname = new URL(u).pathname.toLowerCase();
    const m = pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    if (!m) return "jpg";
    const ext = m[1].toLowerCase();
    return ext === "jpeg" ? "jpg" : ext;
  } catch {
    return "jpg";
  }
}


function isBlockedCtaUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();

  // protokoll / skräp
  if (lower.startsWith("mailto:")) return true;
  if (lower.startsWith("webcal:")) return true;
  if (lower.startsWith("data:")) return true;

  // sociala/redirect/icke-officiella CTA-länkar
  // (vi kan utöka listan senare)
  if (lower.includes("instagram.com/")) return true;
  if (lower.includes("facebook.com/")) return true;
  if (lower.includes("m.facebook.com/")) return true;
  if (lower.includes("tiktok.com/")) return true;
  if (lower.includes("linktr.ee/")) return true;
  if (lower.includes("bit.ly/")) return true;
  if (lower.includes("tinyurl.com/")) return true;

  return false;
}

function isBlockedImageUrl(u) {
  const s = (u ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("javascript:") || lower.startsWith("mailto:") || lower.startsWith("webcal:")) return true;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (url.pathname || "").toLowerCase();
    // Never accept Barnistan as image source (logos/share images)
    if (host.endsWith("barnistan.se")) return true;
    if (host.endsWith("pygmeteatern.se") && path.includes("/img/common/")) return true;
    // Common "logo/default/share" patterns (keep conservative)
    if (lower.includes("barnistan") && (lower.includes("logo") || lower.includes("default") || lower.includes("share"))) return true;
    // ICS/calendar/share pages should never be images
    if (path.endsWith(".ics")) return true;
  } catch {
    return true;
  }
  return false;
}
function extractOgImage(html) {
  // 1) og:image
  const m1 = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (m1 && m1[1]) return m1[1].trim();

  // 2) twitter:image
  const mTw = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  if (mTw && mTw[1]) return mTw[1].trim();

  // 3) image_src
  const m2 = html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);
  if (m2 && m2[1]) return m2[1].trim();

  // Helpers
  const isBad = (u) => {
    const x = String(u || "").toLowerCase();
    if (!x) return true;
    if (x.endsWith(".svg")) return true;
    if (x.includes("logo")) return true;
    if (x.includes("favicon")) return true;
    if (x.includes("sprite")) return true;
    if (x.includes("icon")) return true;
    return false;
  };

  // 4) Prefer featured/poster images (common CMS patterns)
  const featured = html.match(/<img[^>]+class=["'][^"']*(wp-post-image|post-thumbnail|featured|poster|hero|banner|cover)[^"']*["'][^>]+src=["']([^"']+)["']/i);
  if (featured && featured[2] && !isBad(featured[2])) return featured[2].trim();

  // 5) Fallback: first non-logo/non-svg <img src="...">
  const re = /<img[^>]+src=["']([^"']+)["']/ig;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (!u) continue;
    if (isBad(u)) continue;
    return u.trim();
  }

  return null;
}

function absUrlMaybe(base, href) {
  try {
    if (!href) return null;
    const h = String(href).trim();
    if (!h) return null;
    if (h.startsWith("http")) return h;
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

// Per-run cache + per-source budget (avoid slow/abusive crawls)
const OG_CACHE = new Map();
const OG_FETCH_COUNT = new Map(); // source_id -> count
const OG_FETCH_MAX_PER_SOURCE = 40;

async function fetchOgImageFor(source, candidateUrl) {
  const u0 = (candidateUrl || "").trim();
  if (!u0) return null;

  if (OG_CACHE.has(u0)) return OG_CACHE.get(u0);

  const sid = String(source?.id || "");
  const n = OG_FETCH_COUNT.get(sid) || 0;
  if (n >= OG_FETCH_MAX_PER_SOURCE) {
    OG_CACHE.set(u0, null);
    return null;
  }
  OG_FETCH_COUNT.set(sid, n + 1);

  try {
    const res = await fetch(u0, { redirect: "follow" });
    if (!res.ok) {
      OG_CACHE.set(u0, null);
      return null;
    }
    const html = await res.text();
    const og = extractOgImage(html);
    const abs = absUrlMaybe(u0, og);
    const img = abs || og || null;

    if (img && isBlockedImageUrl(img)) {
      OG_CACHE.set(u0, null);
      return null;
    }

    OG_CACHE.set(u0, img);
    return img;
  } catch {
    OG_CACHE.set(u0, null);
    return null;
  }
}


async function cacheImageToStorage(originalUrl) {
  if (!originalUrl) return null;

  // Normalisera HTML-escapes
  const cleanedUrl = decodeHtmlEntities(String(originalUrl).replaceAll("&amp;", "&"));

  if (isBlockedImageUrl(cleanedUrl)) return null;

  if (isAlreadyCachedUrl(cleanedUrl)) {
    return { publicUrl: cleanedUrl, path: null, cachedAt: new Date().toISOString() };
  }

  const ext = extFromUrl(cleanedUrl);
  const hash = crypto.createHash("sha1").update(String(cleanedUrl)).digest("hex").slice(0, 24);
  const path = `v1/${hash}.${ext}`;

  const res = await fetch(cleanedUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "SverigeEventBot/1.0 (+https://sverigeevent.se)",
      "accept": "image/avif,image/webp,image/*,*/*;q=0.8",
      "referer": (() => { try { return new URL(cleanedUrl).origin + "/"; } catch { return ""; } })(),
    },
  });

  if (!res.ok) throw new Error(`image_fetch_failed ${res.status}`);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  // Guard: do NOT cache HTML/error pages as images
  const sigHex = buf.slice(0, 16).toString("hex");

  const isJpg = sigHex.startsWith("ffd8ff");
  const isPng = sigHex.startsWith("89504e470d0a1a0a");
  const isGif =
    buf.slice(0, 6).toString("ascii") === "GIF87a" ||
    buf.slice(0, 6).toString("ascii") === "GIF89a";
  const isWebp =
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP";

  const looksLikeImage = isJpg || isPng || isGif || isWebp;
  const isHtmlLike =
    ct.includes("text/html") ||
    ct.includes("application/xhtml") ||
    ct.includes("application/xml");

  if (!ct.startsWith("image/") || isHtmlLike || !looksLikeImage) {
    throw new Error(`image_not_image ${ct || "no_ct"}`);
  }

  // MVP-guard: max 6MB
  if (buf.length > 6 * 1024 * 1024) throw new Error("image_too_large");

  const contentType =
    ct && ct.startsWith("image/")
      ? ct.split(";")[0]
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/jpeg";

  const up = await supabase.storage.from(EVENT_IMAGES_BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
  });

  if (up.error) throw new Error(`image_upload_failed ${up.error.message}`);

  const pub = supabase.storage.from(EVENT_IMAGES_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl || null;
  if (!publicUrl) throw new Error("image_public_url_failed");

  return { publicUrl, path, cachedAt: new Date().toISOString() };
}



async function upsertEventPrefer(source, payload) {
  const key = payload.canonical_key;
  if (!key) throw new Error("Missing canonical_key");

  const { data: existing, error: selErr } = await supabase
    .from("events")
    .select("id,source_rank,ticket_url,organizer_url,image_url,description,source_url,source_id")
    .eq("canonical_key", key)
    .maybeSingle();

  if (selErr) throw selErr;

  // Image cache: prefer cached storage URL; keep original external in image_url_original
  let cached = null;
  try {
    const incoming = payload.image_url || null;
    const original = (existing && (existing.image_url_original || existing.image_url)) || incoming;

    if (original && !isAlreadyCachedUrl(original)) {
      // Cache if we don't already have a storage path
      const hasPath = existing && existing.image_storage_path;
      if (!hasPath) {
        cached = await cacheImageToStorage(original);
      }
    }
  } catch (e) {
    // Soft-fail: do not break ingestion on image issues
    IMG_CACHE_FAIL += 1;
    bumpFail(e && e.message ? e.message : "cache_error");
    cached = null;
  }

  if (!existing) {
    const insertPayload = { ...payload };

    // Set original if missing
    if (insertPayload.image_url && !insertPayload.image_url_original) {
      insertPayload.image_url_original = insertPayload.image_url;
    }

    // If we cached successfully, store stable URL + metadata
    if (cached && cached.publicUrl) {
      insertPayload.image_url_original = insertPayload.image_url_original || payload.image_url || null;
      insertPayload.image_url = cached.publicUrl;
      insertPayload.image_storage_path = cached.path;
      insertPayload.image_cached_at = cached.cachedAt;
    } else {
      // If not cached, keep whatever came in (may still work short-term)
      insertPayload.image_storage_path = insertPayload.image_storage_path || null;
      insertPayload.image_cached_at = insertPayload.image_cached_at || null;
    }

    const { error: insErr } = await supabase.from("events").upsert(insertPayload, { onConflict: "fingerprint" });
    if (insErr) throw insErr;
    return;
  }

  const inRank = Number(payload.source_rank || 0);
  const exRank = Number(existing.source_rank || 0);

  const patch = {};

  if (inRank >= exRank) {
    // Higher-ranked overwrites primary fields
    patch.source_rank = inRank;
    patch.source_id = payload.source_id;
    patch.source_url = payload.source_url;
    if (payload.ticket_url) patch.ticket_url = payload.ticket_url;
    if (payload.organizer_url) patch.organizer_url = payload.organizer_url;
    if (payload.image_url && !existing?.image_storage_path) patch.image_url = payload.image_url;
    if (payload.description) patch.description = payload.description;
    patch.venue_name = payload.venue_name ?? null;
    patch.category = payload.category ?? null;
  } else {
    // Lower-ranked only fills blanks
    if (!existing.ticket_url && payload.ticket_url) patch.ticket_url = payload.ticket_url;
    if (!existing.organizer_url && payload.organizer_url) patch.organizer_url = payload.organizer_url;
    if ((!existing.image_url || String(existing.image_url).trim() === "") && payload.image_url && !existing.image_storage_path) patch.image_url = payload.image_url;
    if (!existing.image_url_original && payload.image_url) patch.image_url_original = payload.image_url;

    if (cached && cached.publicUrl) {
      patch.image_url_original = (existing.image_url_original || existing.image_url || payload.image_url || null);
      patch.image_url = cached.publicUrl;
      patch.image_storage_path = cached.path;
      patch.image_cached_at = cached.cachedAt;
    }
    if (!existing.description && payload.description) patch.description = payload.description;
    if (!existing.source_url && payload.source_url) patch.source_url = payload.source_url;
    if (!existing.source_id && payload.source_id) patch.source_id = payload.source_id;
  }


  // Audience: only fill if missing (never overwrite existing)
  if (!existing.audience && payload.audience) {
    patch.audience = payload.audience;
  }

  // Subcategory: only fill if missing (never overwrite existing)
  if (!existing.subcategory && payload.subcategory) {
    patch.subcategory = payload.subcategory;
  }

  // If subcategory implies a stronger top-level category, align it (helps fix legacy mislabels)
  const impliedCat = categoryFromSubcategory(payload.subcategory);
  if (impliedCat && payload.category && payload.category !== impliedCat) {
    patch.category = impliedCat;
  }

  if (Object.keys(patch).length === 0) return;

  const { error: updErr } = await supabase.from("events").update(patch).eq("id", existing.id);
  if (updErr) throw updErr;
}

function parsePrice(priceTextRaw) {
  const t = (priceTextRaw || "").toLowerCase();
  if (!t) return { price_type: "unknown", price_min: null, price_max: null };
  if (t.includes("gratis")) return { price_type: "free", price_min: 0, price_max: 0 };

  const nums = (priceTextRaw.match(/\d+/g) || []).map((n) => Number(n));
  if (nums.length === 1) return { price_type: "paid", price_min: nums[0], price_max: nums[0] };
  if (nums.length >= 2) return { price_type: "paid", price_min: Math.min(...nums), price_max: Math.max(...nums) };

  return { price_type: "unknown", price_min: null, price_max: null };
}

async function fetchSources() {
  const { data, error } = await supabase
    .from("sources")
    .select("id,name,url,city,category,parser,kind,is_active")
    .eq("is_active", true);

  if (error) throw error;
  return data ?? [];
}

async function upsertEvent(payload) {
  const { error } = await supabase
    .from("events")
    .upsert(payload, { onConflict: "fingerprint" });

  if (error) throw error;
}

async function logIngestionRun({ source, parser, startedAtISO, finishedAtISO, durationMs, upsertedCount, success, errorMessage }) {
  // 1) Append-only logg
  const { error } = await supabase.from("ingestion_runs").insert({
    source_id: source.id,
    source_name: source.name,
    parser,
    started_at: startedAtISO,
    finished_at: finishedAtISO,
    duration_ms: durationMs,
    upserted_count: upsertedCount,
    success,
    error_message: errorMessage || null,
  });
  if (error) throw error;
}

async function updateSourceHealth({ source, finishedAtISO, durationMs, upsertedCount, success, errorMessage }) {
  // 2) Senaste status på källan
  const patch = {
    last_run_at: finishedAtISO,
    last_duration_ms: durationMs,
    last_upserted_count: upsertedCount,
    last_error: success ? null : (errorMessage || "Unknown error"),
    last_success_at: success ? finishedAtISO : undefined,
  };

  // Supabase skickar inte undefined -> bra, då uppdateras last_success_at bara vid success
  const { error } = await supabase
    .from("sources")
    .update(patch)
    .eq("id", source.id);

  if (error) throw error;
}

async function importICS(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`ICS fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const text = await res.text();

  const parsed = ical.parseICS(text);
  let count = 0;

  for (const k of Object.keys(parsed)) {
    const ev = parsed[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (!ev.start) continue;

    const startISO = new Date(ev.start).toISOString();
    const uid = ev.uid || k;

    const ticketKey = clean((ev.url ? String(ev.url) : "") || source.url) || "";
    const fingerprint = `${source.id}__${uid}__${startISO}__${ticketKey}`;

    const summary = clean(ev.summary) || "Untitled event";
    const desc = clean(ev.description) || null; // ofta plats/arrangör i Google Calendar
    const loc = clean(ev.location) || null;     // ofta tider i denna kalender

    // Default CTA för Tittut (officiell biljettkanal)
    const isTittut = (source.name || "").toLowerCase().includes("tittut");
    const defaultTicketUrl = isTittut ? "https://www.nortic.se/ticket/organizer/3717" : null;
    const defaultOrganizerUrl = isTittut ? "https://dockteaterntittut.se/" : null;

    // City-heuristik: om källan inte sätter city, försök ta prefix före första mellanslag (eller före "/")
    const derivedCity = (() => {
      if (source.city) return source.city;
      const t = String(summary || "").trim();
      if (!t) return null;

      // försök plocka stad från vanligaste separators i titeln
      let candidate = null;

      if (t.includes(" - ")) {
        candidate = t.split(" - ").pop();
      } else if (t.includes("-")) {
        candidate = t.split("-").pop();
      } else if (t.includes(":")) {
        candidate = t.split(":").pop();
      } else if (t.includes(", ")) {
        candidate = t.split(", ").pop();
      } else if (t.includes("/")) {
        // format: "Ort / Titel" eller "Show / Ort"
        const parts = t.split("/").map(x => String(x || "").trim()).filter(Boolean);
        const left = parts[0] || "";
        const right = parts[parts.length - 1] || "";

        const looksLikePlace = (x) => {
          if (!x) return false;
          if (x.length < 3 || x.length > 30) return false;
          if (/[0-9]/.test(x)) return false;
          if (/[.!?]/.test(x)) return false;
          // ofta ort som ett ord med stor bokstav (åäö ok)
          return /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(x);
        };

        candidate = looksLikePlace(left) ? left : right;
      } else {
        // format: "... i Ort" -> Ort
        const m = t.match(/\bi\s+([A-Za-zÅÄÖåäö\-]{3,})\s*$/);
        if (m && m[1]) candidate = m[1];
      }


      const isBadCityToken = (x) => {
        const v = String(x || "").trim();
        if (!v) return true;
        const low = v.toLowerCase();

        // vanliga icke-orter / show-prefix
        const bad = new Set([
          "premiär",
          "premiar",
          "didi",
          "gogo",
          "vilda",
          "bebin",
          "knyttet",
          "nasse",
          "inställt",
          "installt",
          "snö",
        ]);
        if (bad.has(low)) return true;

        // all-caps showtoken (t.ex. VILDA) är ofta inte ort
        if (/^[A-ZÅÄÖ]{3,}$/.test(v)) return true;

        return false;
      };

      if (!candidate) {
        // fallback när titel saknar separators: prova premiär/first/last
        if (/\bpremiär\b/i.test(t)) {
          const last = t.split(" ").pop()?.trim() || "";
          if (!isBadCityToken(last) && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(last)) return last;
        }

        {
          const first = t.split(" ")[0]?.trim() || "";
          if (first.length >= 3 && first.length <= 30 && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(first)) {
            if (!isBadCityToken(first)) return first;
          }
        }

        {
          const last = t.split(" ").pop()?.trim() || "";
          if (last.length >= 3 && last.length <= 30 && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(last)) {
            if (!isBadCityToken(last)) return last;
          }
        }

        return null;
      }

      candidate = String(candidate).trim();

      // special: "SNÖ Premiär Piteå" -> ta sista ordet om det inte är bad token
      if (/\bpremiär\b/i.test(t)) {
        const last = t.split(" ").pop()?.trim() || "";
        if (!isBadCityToken(last) && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(last)) return last;
      }

      // extra: om titeln är "Ort Titel" (t.ex. "Simrishamn Vilda bebin") -> ta första ordet som ort
      {
        const first = t.split(" ")[0]?.trim() || "";
        if (first.length >= 3 && first.length <= 30 && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(first)) {
          if (!isBadCityToken(first)) return first;
        }
      }

      // extra: om titeln slutar på ett ortnamn (t.ex. "SNÖ Premiär Piteå") -> ta sista ordet
      {
        const last = t.split(" ").pop()?.trim() || "";
        if (last.length >= 3 && last.length <= 30 && /^[A-ZÅÄÖ][A-Za-zÅÄÖåäö\-]+$/.test(last)) {
          if (!isBadCityToken(last)) return last;
        }
      }

      // om candidate har komma (t.ex. "Kulturscenen, Täby kulturhus") -> ta sista segmentet som city-kandidat
      if (candidate.includes(",")) {
        candidate = candidate.split(",").pop().trim();
      }

      // om vi har "Spelplats, Stad" -> ta sista segmentet efter komma
      if (candidate.includes(",")) {
        candidate = candidate.split(",").pop().trim();
      }

      // sanitet: för kort, punkt eller konstiga tokens
      if (candidate.length < 3) return null;
      if (candidate.includes(".")) return null;

      // om candidate ser ut som venue (t.ex. "Sävsjö kulturhus") -> ta första ordet
      const lower = candidate.toLowerCase();
      const venueSuffixes = [" kulturhus", " teatern", " kyrkan", " bibliotek", " biblioteket", " bygdegård", " bygdegårdar", " scen", " salen", " sal"];
      if (venueSuffixes.some(suf => lower.endsWith(suf))) {
        const first = candidate.split(" ")[0]?.trim() || "";
        if (first.length >= 3 && !first.includes(".")) return first;
      }

      return candidate;
    })();

    // Venue från SUMMARY (t.ex. "Stora teatern, Göteborg") när DESCRIPTION saknas/är lång
    const venueFromSummary = (() => {
      const t = String(summary || "").trim();
      if (!t) return null;

      let tail = null;
      if (t.includes(" - ")) tail = t.split(" - ").pop();
      else if (t.includes("-")) tail = t.split("-").pop();
      else if (t.includes(":")) tail = t.split(":").pop();
      else {
        const m = t.match(/\bpå\s+(.+)$/i);
        if (m) tail = m[1];
        else if (t.includes(", ")) tail = t.split(", ").pop();
      }
      if (!tail) return null;

      tail = tail.trim();
      if (!tail) return null;

      // om "Spelplats, Stad" -> ta delen före sista kommat
      const venuePart = tail.includes(",") ? tail.split(",")[0].trim() : tail;

      // undvik att sätta venue till samma som city
      if (!isTittut && derivedCity && venuePart === derivedCity) return null;

      return venuePart ? normalizeVenue(venuePart) : null;
    })();

    // Venue: om DESCRIPTION är kort, behandla som venue, annars lägg den i beskrivning
    const venueFromDesc = (desc && desc.length <= 140) ? normalizeVenue(desc) : null;
    const longDesc = (desc && desc.length > 140) ? desc : null;

    // City fallback från venue när title-heuristik inte räcker (Tittut har ofta ort i spelplats-text)
    const extractCityFromVenue = (v) => {
      const raw = String(v || "").trim();
      if (!raw) return null;

      // strip enkla HTML-taggar
      const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) return null;

      // om "Spelplats, Ort" -> Ort (sista segmentet)
      if (text.includes(", ")) {
        const last = text.split(", ").pop().trim();
        if (last.length >= 3) return last;
      }

      // om svenskt postnummer finns: "123 45 Ort" -> Ort
      {
        const m = text.match(/\b\d{3}\s?\d{2}\s+([A-Za-zÅÄÖåäö\-]{3,})\b/);
        if (m && m[1]) return m[1];
      }

      // om "... Ort, Sverige" eller "... Ort Sverige" -> Ort (sista ordet före Sverige)
      if (/\bSverige\b/i.test(text)) {
        const parts = text.split(/\bSverige\b/i)[0].trim().split(" ");
        const last = parts[parts.length - 1]?.trim();
        if (last && last.length >= 3) return last;
      }

      // fallback: första ordet (t.ex. "Kista bibliotek" -> Kista)
      const first = text.split(" ")[0]?.trim() || "";
      if (first.length >= 3 && !first.includes(".")) return first;

      return null;
    };

    const rawVenueForCity = venueFromDesc || venueFromSummary || null;
    const derivedCity2 = derivedCity || extractCityFromVenue(rawVenueForCity);

    // Beskrivning: tider från LOCATION, plus ev lång DESCRIPTION
    const builtDescription = (() => {
      const parts = [];
      if (loc) parts.push("Tid: " + loc);
      if (longDesc) parts.push(longDesc);
      return parts.length ? parts.join("\n") : null;
    })();

    const evUrl = clean(ev.url) || null;

    const payload = {
      fingerprint,
      source_id: String(source.id),
      title: summary,
      description: builtDescription,
      category: source.category ?? null,
      start_at: startISO,
      end_at: ev.end ? new Date(ev.end).toISOString() : null,
      city: derivedCity2,
      venue_name: venueFromDesc || venueFromSummary || (isTittut ? derivedCity2 : null),
      price_type: "unknown",
      ticket_url: evUrl || defaultTicketUrl,
      organizer_url: defaultOrganizerUrl || null,
      source_url: source.url,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}

function extractField(block, label) {
  const idx = block.indexOf(label);
  if (idx === -1) return null;
  return clean(block.slice(idx + label.length));
}

async function importKulturStockholm(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cards = [];

  $("h4").each((_, h4) => {
    const a = $(h4).find("a").first();
    const title = clean(a.text());
    if (!title) return;

    const href = a.attr("href") || null;

    let cursor = $(h4).next();
    let blob = "";

    while (cursor.length && cursor[0].tagName !== "h4") {
      const t = clean(cursor.text());
      if (t) blob += (blob ? "\n" : "") + t;
      cursor = cursor.next();
    }

    const datum = extractField(blob, "Datum:");
    const tid = extractField(blob, "Tid:");
    const plats = extractField(blob, "Plats:");
    const pris = extractField(blob, "Pris:");

    cards.push({ title, href, datum, tid, plats, pris });
  });

  const seen = new Set();
  const unique = [];
  for (const c of cards) {
    const key = `${c.title}__${c.datum || ""}__${c.plats || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  let count = 0;

  for (const c of unique) {
    const price = parsePrice(c.pris);

    const fingerprint = `${source.id}__${c.title}__${c.datum || ""}__${c.plats || ""}`;

    // MVP: temporär start_at (vi fixar riktig datumtolkning i nästa iteration)
    const startISO = new Date().toISOString();

    const payload = {
      fingerprint,
      title: c.title,
      description: [c.datum && `Datum: ${c.datum}`, c.tid && `Tid: ${c.tid}`, c.plats && `Plats: ${c.plats}`, c.pris && `Pris: ${c.pris}`]
        .filter(Boolean)
        .join("\n"),
      category: source.category ?? null,
      start_at: startISO,
      end_at: null,
      city: source.city ?? null,
      venue_name: normalizeVenue(c.plats),
      price_type: price.price_type,
      price_min: price.price_min,
      price_max: price.price_max,
      ticket_url: c.href,
      source_url: source.url,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}


function parseVisitDateRange(raw) {
  const t = clean(raw);
  if (!t) return { startISO: null, endISO: null };

  const months = {
    jan: 0, januari: 0,
    feb: 1, februari: 1,
    mar: 2, mars: 2,
    apr: 3, april: 3,
    maj: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    aug: 7, augusti: 7,
    sep: 8, september: 8,
    okt: 9, oktober: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  function parseOne(s) {
    const m = String(s).trim().match(/^([A-Za-zÅÄÖåäö]{3,9})\s+(\d{1,2})$/);
    if (!m) return null;
    const mon = months[m[1].toLowerCase()];
    if (mon === undefined) return null;
    const day = Number(m[2]);
    return { mon, day };
  }

  const parts = t.split("-").map((x) => x.trim());
  const a = parseOne(parts[0]);
  const b = parts[1] ? parseOne(parts[1]) : null;
  if (!a) return { startISO: null, endISO: null };

  // Year-inferens: om datumet ligger "bakåt" långt i tiden, anta nästa år
  const now = new Date();
  let yearA = now.getUTCFullYear();
  const approxA = new Date(Date.UTC(yearA, a.mon, a.day, 12, 0, 0));
  if (approxA.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) yearA += 1;

  const start = new Date(Date.UTC(yearA, a.mon, a.day, 12, 0, 0));

  let end = null;
  if (b) {
    let yearB = yearA;
    const approxB = new Date(Date.UTC(yearB, b.mon, b.day, 12, 0, 0));
    if (approxB.getTime() < start.getTime()) yearB += 1;
    end = new Date(Date.UTC(yearB, b.mon, b.day, 12, 0, 0));
  }

  return { startISO: start.toISOString(), endISO: end ? end.toISOString() : null };
}

async function importVisitStockholm(source) {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": "SverigeEventBot/0.1 (+local dev)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const nextDataText = $("script#__NEXT_DATA__").text();
  if (!nextDataText) return 0;

  let nextData;
  try {
    nextData = JSON.parse(nextDataText);
  } catch (e) {
    throw new Error("Visit: kunde inte JSON-parsa __NEXT_DATA__");
  }

  const blocks = nextData?.props?.pageProps?.componentProps?.contentBlocks || [];
  const rawItems = [];

  for (const b of blocks) {
    const items = b?.value?.items;
    if (Array.isArray(items)) {
      for (const it of items) rawItems.push(it);
    }
  }

  // Filtrera till objekt som ser ut som event
  const candidates = rawItems.filter((it) =>
    it &&
    typeof it === "object" &&
    typeof it.title === "string" &&
    it.title.length >= 2 &&
    typeof it.startDate === "string" &&
    typeof it.href === "string"
  );

  // Dedup på href + startDate
  const seen = new Set();
  const unique = [];
  for (const it of candidates) {
    const key = `${it.href}__${it.startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  let count = 0;

  for (const it of unique) {
    const startISO = new Date(it.startDate).toISOString();
    const endISO = it.endDate ? new Date(it.endDate).toISOString() : null;

    // href kan vara intern eller extern
    const hrefAbs = it.href.startsWith("http")
      ? it.href
      : it.href.startsWith("/")
        ? `https://www.visitstockholm.se${it.href}`
        : `https://www.visitstockholm.se/${it.href}`;

    const ticket = it.externalWebsiteUrl && String(it.externalWebsiteUrl).startsWith("http")
      ? String(it.externalWebsiteUrl)
      : hrefAbs;

    const venue = it.venueName || it.address || (it.location && (it.location.name || it.location.title)) || null;

    const ticketKey = clean(ticket || hrefAbs) || "";
    const fingerprint = `${source.id}__${hrefAbs}__${startISO}__${ticketKey}`;

    const payload = {
      fingerprint,
      title: clean(it.title) || "Untitled event",
      description: clean(it.description),
      category: source.category ?? null,
      start_at: startISO,
      end_at: endISO,
      city: (it.city ? clean(it.city) : null) ?? (source.city ?? null),
      venue_name: normalizeVenue(venue),
      price_type: "unknown",
      ticket_url: ticket,
      source_url: hrefAbs,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}



function parseKonserthusetDateTime(raw) {
  // Ex: "Måndag 5 januari 2026 kl 17.00"
  const t = clean(raw);
  if (!t) return null;

  const months = {
    januari: 0, february: 1, februari: 1, mars: 2, april: 3, maj: 4, juni: 5, juli: 6,
    augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
  };

  const m = t.match(/(\d{1,2})\s+([A-Za-zÅÄÖåäö]+)\s+(\d{4})\s+kl\s+(\d{1,2})\.(\d{2})/i);
  if (!m) return null;

  const day = Number(m[1]);
  const monName = m[2].toLowerCase();
  const year = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);

  const mon = months[monName];
  if (mon === undefined) return null;

  // Lokal tid i Stockholm → lagra som UTC ISO med korrekt offset via Date()
  // Vi skapar först en datumsträng som JS tolkar som lokal tid.
  const local = new Date(year, mon, day, hh, mm, 0);
  return local.toISOString();
}

async function importKonserthuset(source) {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": "SverigeEventBot/0.1 (+local dev)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];

  $("h3").each((_, el) => {
    const title = clean($(el).text());
    if (!title) return;

    const parent = $(el).parent();
    const blockText = clean(parent.text()) || "";

    const dateMatch = blockText.match(/(Måndag|Tisdag|Onsdag|Torsdag|Fredag|Lördag|Söndag)\s+\d{1,2}\s+\w+\s+\d{4}\s+kl\s+\d{1,2}\.\d{2}/i);
    const dateLine = dateMatch ? dateMatch[0] : null;

    // href: ibland sitter den runt hela kortet, ibland nära titeln
    const a = $(el).closest("a").length ? $(el).closest("a") : parent.find("a").first();
    const href = a.attr("href") || null;

        if (!dateLine || !href) return;

    items.push({ title, dateLine, href });
  });

  // Dedup
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const key = `${it.href}__${it.dateLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  let count = 0;

  for (const it of unique) {
    const startISO = parseKonserthusetDateTime(it.dateLine);
    if (!startISO) continue;

    const hrefAbs = it.href.startsWith("http")
      ? it.href
      : it.href.startsWith("/")
        ? `https://www.konserthuset.se${it.href}`
        : `https://www.konserthuset.se/${it.href}`;

    const fingerprint = `${source.id}__${hrefAbs}__${startISO}`;

    const payload = {
      fingerprint,
      title: it.title,
      description: it.dateLine ? `Tid: ${it.dateLine}` : null,
      category: source.category ?? null,
      start_at: startISO,
      end_at: null,
      city: source.city ?? "Stockholm",
      venue_name: "Konserthuset Stockholm",
      price_type: "unknown",
      ticket_url: hrefAbs,
      source_url: hrefAbs,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}


async function run() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");

  let sources = await fetchSources();
  if (sources.length === 0) {
    console.log("Inga aktiva källor i 'sources'.");
    return;
  }

  // CLI filter: kör bara matchande källor (snabb iteration)
  // Ex: node scripts/import-sources.mjs --only "Dockteatern Tittut"
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx !== -1) {
    const q = (process.argv[onlyIdx + 1] || "").trim().toLowerCase();
    if (!q) throw new Error("Missing value for --only");
    sources = sources.filter(x => String(x.name || "").toLowerCase().includes(q));
    console.log(`[ONLY] running ${sources.length} source(s) matching "${q}"`);
    if (sources.length === 0) return;
  }

  let total = 0;

  for (const s of sources) {
  const t0 = Date.now();
    let parser = ((s.kind || "").toLowerCase() === "ics" ? "ics" : ((s.parser || "html").toLowerCase()));
    // Routing: alla *_html behandlas som "html" (utom tickster_html)
    if (parser === "ics") {
      try {
      const n = await importICS(s);
      const ms = Date.now() - t0;
      console.log(`✅ [ICS] ${s.name}: ${n} (${ms} ms)`);
      total += n;
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
            source: s,
            parser: "ics",
            startedAtISO: new Date(t0).toISOString(),
            finishedAtISO,
              durationMs: ms,
              upsertedCount: n,
              success: true,
              errorMessage: null,
        });
        await updateSourceHealth({
            source: s,
            finishedAtISO,
              durationMs: ms,
              upsertedCount: n,
              success: true,
              errorMessage: null,
        });
      } catch (e) {
        const ms = Date.now() - t0;
        console.log(`❌ [ICS] ${s.name}: ${e.message} (${ms} ms)`);
        
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
          source: s,
          parser: "ics",
          startedAtISO: new Date(t0).toISOString(),
          finishedAtISO,
            durationMs: ms,
            upsertedCount: 0,
            success: false,
            errorMessage: e.message,
        });
        await updateSourceHealth({
          source: s,
          finishedAtISO,
            durationMs: ms,
            upsertedCount: 0,
            success: false,
            errorMessage: e.message,
        });
      }
      continue;
    }
    if (parser === "tickster_html") {
      try {
        const items = await importTickster(s);
        let n = 0;

        for (const e of (items || [])) {
          if (!e?.title || !e?.start_at || !e?.source_url) continue;

                const ticketKey = clean(e.ticket_url || e.organizer_url || e.source_url) || "";
          const fingerprint = `${s.id}__${e.source_url}__${e.start_at}__${ticketKey}`;

          const payload = {
            fingerprint,
            title: e.title || "Untitled event",
            description: null,
            category: inferGenreCategory({ source: s, it: e }) ?? null,
            audience: inferAudience({ source: s, it: e }),
            subcategory: e.subcategory ?? inferSubcategory({ source: s, it: e }) ?? null,
            start_at: e.start_at,
            end_at: e.end_at ?? null,
            city: s.city ?? "Stockholm",
            venue_name: normalizeVenue(e.venue_name),
            price_type: "unknown",
            price_min: null,
            price_max: null,
            ticket_url: e.ticket_url ?? e.source_url,
            source_url: e.source_url,
            status: "active",
          };

          await upsertEvent(payload);
          n += 1;
        }

        const ms = Date.now() - t0;
        console.log(`✅ [HTML] ${s.name}: ${n} (${ms} ms)`);
        total += n;

        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
            source: s,
            parser: "tickster_html",
            startedAtISO: new Date(t0).toISOString(),
            finishedAtISO,
              durationMs: ms,
              upsertedCount: n,
              success: true,
              errorMessage: null,
        });
        await updateSourceHealth({
            source: s,
            finishedAtISO,
              durationMs: ms,
              upsertedCount: n,
              success: true,
              errorMessage: null,
        });
      } catch (e) {
        const ms = Date.now() - t0;
        console.log(`❌ [HTML] ${s.name}: ${e.message} (${ms} ms)`);

        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
            source: s,
            parser: "tickster_html",
            startedAtISO: new Date(t0).toISOString(),
            finishedAtISO,
              durationMs: ms,
              upsertedCount: 0,
              success: false,
              errorMessage: e.message,
        });
        await updateSourceHealth({
            source: s,
            finishedAtISO,
              durationMs: ms,
              upsertedCount: 0,
              success: false,
              errorMessage: e.message,
        });
      }
      continue;
    }

if (parser === "html" || HTML_PARSERS[parser]) {
  const key = (parser === "html" ? (s.parser || "") : parser).toLowerCase();
  const fn = HTML_PARSERS[key];

  if (!fn) {
    console.log(`⚠️ [HTML] ${s.name}: ingen parser för key="${key}" (parser="${s.parser}", kind="${s.kind}") (${s.url})`);
    continue;
  }

  try {
    const out = await fn(s);

    // Parsers kan returnera:
    //  - number (redan upsertat internt)
    //  - array av items { title, start_at, end_at?, venue_name?, city?, ticket_url?, source_url? }
    const now = Date.now();
    const maxFutureMs = 1000 * 60 * 60 * 24 * 365; // 365 dagar

    let n = 0;

    if (typeof out === "number") {
      n = out;
    } else if (Array.isArray(out)) {
      for (const it of out) {
        if (!it || !it.start_at) continue;

        const t = Date.parse(it.start_at);
        if (!Number.isFinite(t)) continue;

        // Filtrera bort uppenbart fel:
        // - äldre än 2 dagar bakåt
        // - mer än 365 dagar framåt
        if (t < now - 1000 * 60 * 60 * 24 * 2) continue;
        if (t > now + maxFutureMs) continue;

        const startISO = new Date(t).toISOString();
        const title = it.title || "Untitled event";
        const aud = inferAudience({ source: s, it: { ...it, title } });

        const ticket = it.ticket_url || null;
        const src = it.source_url || s.url;

        const ticketKey = clean(ticket || src) || "";
        const fingerprint = `${s.id}__${ticket || src}__${startISO}__${ticketKey}__${normalizeTitleForKey(title)}`;

        await upsertEventPrefer(s, {
          source_id: s.id,
          source_rank: sourceRank(s),
          canonical_key: canonicalKeyFor({ title, startISO, city: (it.city || s.city || null) }),
          fingerprint,
          title: title,
          description: it.description || null,
          category: inferGenreCategory({ source: s, it }) ?? null,
            audience: aud,
            subcategory: it.subcategory ?? inferSubcategory({ source: s, it }) ?? null,
          start_at: startISO,
          end_at: it.end_at || null,
          city: it.city || s.city || null,
          venue_name: it.venue_name || null,
          price_type: it.price_type || "unknown",
          price_min: it.price_min ?? null,
          price_max: it.price_max ?? null,
          ticket_url: ticket,
          organizer_url: it.organizer_url || null,

          image_url: (it.image_url || (await (async () => {
            const cand = it.ticket_url || it.organizer_url || it.source_url || it.listing_url || null;
            return await fetchOgImageFor(s, cand);
          })())) || null,
          listing_url: it.listing_url || null,
          source_url: src,
          status: "active",
        });

        n += 1;
      }
    } else {
      throw new Error(`Parser returnerade oväntad typ: ${typeof out}`);
    }

    const ms = Date.now() - t0;
    console.log(`✅ [HTML] ${s.name}: ${n} (${ms} ms)`);
    total += n;

    const finishedAtISO = new Date().toISOString();
    await logIngestionRun({
        source: s,
        parser: key,
        startedAtISO: new Date(t0).toISOString(),
        finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
    });

    await updateSourceHealth({
        source: s,
        finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
    });
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`❌ [HTML] ${s.name}: ${e.message} (${ms} ms)`);

    const finishedAtISO = new Date().toISOString();
    await logIngestionRun({
        source: s,
        parser: key,
        startedAtISO: new Date(t0).toISOString(),
        finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
    });

    await updateSourceHealth({
        source: s,
        finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
    });
  }

  continue;
}

    console.log(`⚠️ ${s.name}: okänd parser "${parser}"`);
  }

  {
    const top = Array.from(IMG_CACHE_FAIL_BY.entries())
      .sort((a,b) => b[1]-a[1])
      .slice(0, 6);
    console.log("[IMG_CACHE_SUMMARY]", {
      attempts: IMG_CACHE_ATTEMPTS,
          success: IMG_CACHE_SUCCESS,
      fail: IMG_CACHE_FAIL,
      topErrors: top,
    });
  }
  console.log(`Klart. Totalt upsertade ${total} events.`);
}


// Run only when executed directly
if (process.argv[1] && process.argv[1].endsWith("scripts/import-sources.mjs")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

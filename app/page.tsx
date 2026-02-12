import BottomFilterBar from "./_components/BottomFilterBar";
import { SWEDISH_CITIES } from "@/lib/swedishCities";

import DescriptionToggle from "./_components/DescriptionToggle";
import Hero from "./_components/Hero";
// === Category UI mapping ===
const CATEGORY_UI_MAP = {
  kultur: { label: "Teater", slug: "teater" },
  teater: { label: "Teater", slug: "teater" }, // framtidssäker
  familj: { label: "Familj", slug: "familj" },
  musik: { label: "Konsert", slug: "konsert" },
};

import { supabaseServer } from "../lib/supabaseServer";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";
export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  title: string | null;
  description_text: string | null;
  start_at: string;
  city: string | null;
  venue_name: string | null;
  category: string | null;
  subcategory: string | null;
  audience: string | null;
  image_url: string | null;
  price_type: "free" | "paid" | "unknown" | null;
  price_min: number | null;
  price_max: number | null;
  ticket_url: string | null;
  organizer_url: string | null;
  source_url: string | null;
};

type SourceRow = {
  name: string;
  url: string;
};

function firstParam(v: string | string[] | undefined) {
  if (!v) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function buildHref(current: URLSearchParams, patch: Record<string, string>) {
  const next = new URLSearchParams(current.toString());
  for (const [k, val] of Object.entries(patch)) {
    if (!val) next.delete(k);
    else next.set(k, val);
  }
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}

function formatPrice(e: EventRow) {
  if (e.price_type === "free") return "Gratis";
  if (e.price_type === "paid") {
    if (e.price_min != null && e.price_max != null && e.price_min !== e.price_max) return `${e.price_min}–${e.price_max} kr`;
    if (e.price_min != null) return `${e.price_min} kr`;
    return "Betald";
  }
  return "Okänt";
}

function isMusicalEvent(e: any) {
  const sub = (e.subcategory ?? "").toLowerCase();
  if (sub === "musikal") return true;

  const title = (e.title ?? "").toLowerCase();
  const venue = (e.venue_name ?? "").toLowerCase();
  const blob = (title + " " + venue).replace(/\s+/g, " ").trim();

  // keywords / known titles
  if (blob.includes("musikal")) return true;

  // known musical titles (UI-only allowlist)
  if (blob.includes("joyride")) return true;
  if (blob.includes("dear evan hansen")) return true;

  return false;
}


function isStandupEvent(e: any) {
  const sub = (e.subcategory ?? "").toLowerCase();
  if (sub.includes("standup") || sub.includes("comedy")) return true;

  const title = (e.title ?? "").toLowerCase();
  const venue = (e.venue_name ?? "").toLowerCase();
  const blob = (title + " " + venue).replace(/\s+/g, " ").trim();

  // keywords
  if (blob.includes("standup") || blob.includes("stand-up") || blob.includes("comedy")) return true;

  // known standup titles (UI-only allowlist)
  if (blob.includes("evigt edvin")) return true;

  return false;
}

function isOperaEvent(e: any) {
  const sub = (e.subcategory ?? "").toLowerCase();
  if (sub.includes("opera")) return true;

  const title = (e.title ?? "").toLowerCase();
  const venue = (e.venue_name ?? "").toLowerCase();
  const blob = (title + " " + venue).replace(/\s+/g, " ").trim();

  // venues / keywords
  if (blob.includes("opera")) return true;

  // common canonical works (UI-only allowlist for now)
  if (title.startsWith("carmen")) return true;

  return false;
}

function splitEventTitle(raw: string | null) {
  const t = (raw ?? "").trim();
  if (!t) return { main: "—", sub: "" };

  // Prefer dash splits
  const dash = t.includes(" – ") ? " – " : (t.includes(" - ") ? " - " : "");
  if (dash) {
    const [a, ...rest] = t.split(dash);
    return { main: (a ?? "").trim(), sub: rest.join(dash).trim() };
  }

  // Then " på " (Joyride på China Teatern 2026)
  const idx = t.toLowerCase().indexOf(" på ");
  if (idx > 0) {
    return { main: t.slice(0, idx).trim(), sub: t.slice(idx + 1).trim() }; // keeps "på ..."
  }

  return { main: t, sub: "" };
}

function effectiveCategory(e: any) {
  const raw = (e.category ?? "").toLowerCase();
  const title = (e.title ?? "").toLowerCase();
  const venue = (e.venue_name ?? "").toLowerCase();
  const blob = (title + " " + venue).replace(/\s+/g, " ").trim();

  const hasAny = (words: string[]) => words.some(w => blob.includes(w));

  // Strong overrides to Övrigt (museer/visningar/utställningar etc)
  if (hasAny(["museum", "museet", "museer", "utställ", "visning", "guidad", "guidning", "rundtur", "föreläs", "workshop", "bokklubb", "bookclub", "doftvisning", "tunnelbana", "tunnelbanan"])) {
    return "övrigt";
  }

  // Strong overrides to Teater
  if (hasAny(["teater", "föreställ", "musikal", "pantomim", "dockteater", "scen"])) {
    return "teater";
  }

  // Standup
  if (hasAny(["standup", "stand-up", "comedy", "humor"])) {
    return "standup";
  }

  // Musik (only if it looks like music)
  if (hasAny(["konsert", "spelning", "live", "dj", "band"])) {
    return "musik";
  }

  // Otherwise, respect raw category but normalize
  if (raw === "kultur") return "teater";
  if (raw === "musikal") return "teater";
  if (raw === "familj") return "övrigt"; // family is audience, not primary category
  if (raw === "music") return "musik";
  return raw || "övrigt";
}

function categoryLabel(cat: string | null) {
  const c = (cat ?? "").toLowerCase();
  if (c === "familj") return "Övrigt";
  if (c === "kultur" || c === "teater") return "Teater";
  if (c === "musik") return "Musik";
  return "Övrigt";
}

function chipClass(kind: "primary" | "muted" | "cat" | "free", cat?: string | null) {
  if (kind === "primary") return "bg-slate-900 text-white ring-slate-900";
  if (kind === "free") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (kind === "cat") {
    const c = (cat ?? "").toLowerCase();
    if (c === "musik") return "bg-sky-50 text-sky-800 ring-sky-200";
    if (c === "kultur") return "bg-violet-50 text-violet-800 ring-violet-200";
    if (c === "familj") return "bg-amber-50 text-amber-900 ring-amber-200";
    return "bg-slate-50 text-slate-700 ring-slate-200";
  }
  return "bg-white text-slate-700 ring-slate-200";
}

function isCoordLikeVenue(v: string | null) {
  if (!v) return false;
  const t = v.trim();
  // Matchar "lat,lon" med valfritt +/- och decimaler, tillåter whitespace runt kommatecken.
  // Ex: "59.3293,18.0686" eller "-33.8650, 151.2094"
  return /^[-+]?\d+(?:\.\d+)?\s*,\s*[-+]?\d+(?:\.\d+)?$/.test(t);
}

function sourceLabelForEvent(e: EventRow, sources: SourceRow[]) {
  const candidates = [e.source_url, e.ticket_url].filter(Boolean) as string[];
  for (const cand of candidates) {
    try {
      const u = new URL(cand);
      const origin = u.origin;

      const byPrefix = sources.find((s) => cand.startsWith(s.url));
      if (byPrefix) return byPrefix.name;

      const byOrigin = sources.find((s) => {
        try {
          return new URL(s.url).origin === origin;
        } catch {
          return false;
        }
      });
      if (byOrigin) return byOrigin.name;
    } catch {}
  }
  return "Okänd källa";
}

function looksBadImageUrl(u: string | null) {
  const s = (u ?? "").trim().toLowerCase();
  if (!s) return true;

  // Obvious non-event images (keep conservative and avoid false-positives like "inspiration" -> "icon")
  if (s.includes("logo")) return true;
  if (s.includes("sprite")) return true;
  if (s.includes("favicon")) return true;
  if (s.includes("apple-touch")) return true;
  if (s.includes("touch-icon")) return true;
  if (s.includes("manifest")) return true;

  // "icon" must be a real path/file token, not a substring inside words
  // Matches: /icon , /icons , icon-*, icon_*, *-icon.*, *_icon.*
  if (/(^|\/)(icons?)(\/|$)/i.test(s)) return true;
  if (/(^|\/|[-_])icon([-_]|\.|$)/i.test(s)) return true;

  // SVG is often logos/icons (but don't substring-match "inspiration")
  if (s.endsWith(".svg") && (s.includes("logo") || /(^|\/)(icons?)(\/|$)/i.test(s) || /(^|\/|[-_])icon([-_]|\.|$)/i.test(s))) return true;

  return false;
}

function fallbackImageForCategory(cat: string) {
  const c = (cat || "").toLowerCase();
  if (c === "teater" || c === "musikal") return "/placeholders/teater.svg";
  if (c === "musik") return "/placeholders/musik.svg";
  if (c === "standup") return "/placeholders/standup.svg";
  if (c === "familj") return "/placeholders/familj.svg";
  return "/placeholders/ovrigt.svg";
}

function bestImageSrc(e: any) {
  const u = (e.image_url ?? "").trim();
  if (u && !looksBadImageUrl(u)) return u;
  return fallbackImageForCategory(effectiveCategory(e));
}

function sanitizeDesc(input: string | null) {
  let t = (input ?? "").trim();
  if (!t) return "";

  // Strip HTML comments: <!-- ... -->
  t = t.replace(/<!--([\s\S]*?)-->/g, " ");

  // Common boilerplate / junk seen in feeds (Visit Stockholm etc)
  const junk = [
    "Det verkar inte som att din webbläsare har JavaScript aktiverat",
    "vilket behövs för att använda den här siten",
    "Logga in",
    "Mitt konto",
  ];
  for (const j of junk) t = t.replaceAll(j, " ");

  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();

  // Hard cap to avoid insane blocks (still expandable in detail later if needed)
  if (t.length > 1200) t = t.slice(0, 1200).trim();

  return t;
}


function isBlockedCtaHost(u?: string | null) {
  const s = (u ?? "").trim();
  if (!s) return true;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.endsWith("dn.se")) return true;
    if (host.endsWith("welma.se")) return true;
    if (host.endsWith("barnistan.se")) return true;
    if (host.endsWith("calendar.google.com")) return true;
    const p = url.pathname.toLowerCase();
    if (p.endsWith(".ics")) return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    return false;
  } catch {
    return true;
  }
}

function primaryCtaUrl(e: any) {
  const cand = [e.ticket_url, e.organizer_url].find((u: any) => u && !isBlockedCtaHost(u));
  return cand || null;
}


function normKey(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’'"]/g, "")
    .replace(/[^a-z0-9åäö \-]/gi, " ")
    .trim();
}

function eventDedupeKey(e: any) {
  const title = normKey(e.title || "");
  return title;
}


function scoreEventForList(e: any) {
  let score = 0;
  if (primaryCtaUrl(e)) score += 100;
  if (e.image_url) score += 30;

  const cat = (e.category || "").toLowerCase();
  if (cat && cat !== "ovrigt" && cat !== "övrigt" && cat !== "familj") score += 10;

  if ((e.audience || "").toLowerCase() === "familj") score += 5;

  const dlen = (sanitizeDesc(e.description_text) || "").length;
  score += Math.min(20, Math.floor(dlen / 80));
  return score;
}

function dedupeEventsForList(events: any[]) {
  const best = new Map<string, any>();
  const isOvr = (c: string) => c === "övrigt" || c === "ovrigt" || c === "" || c === "familj";

  for (const e of events) {
    const k = eventDedupeKey(e);
    const prev = best.get(k);

    if (!prev) {
      best.set(k, { ...e });
      continue;
    }

    // Merge flags
    const audPrev = (prev.audience || "").toLowerCase();
    const audCur = (e.audience || "").toLowerCase();
    if (audPrev !== "familj" && audCur === "familj") prev.audience = "familj";

    const cPrev = (prev.category || "").toLowerCase();
    const cCur = (e.category || "").toLowerCase();
    if (isOvr(cPrev) && !isOvr(cCur)) prev.category = e.category;

    // Pick best row
    const sp = scoreEventForList(prev);
    const sc = scoreEventForList(e);
    if (sc > sp) {
      best.set(k, { ...prev, ...e });
    } else if (sc === sp) {
      // Tie-breaker: keep earliest start_at
      const a = String(prev.start_at || "");
      const b = String(e.start_at || "");
      if (b && (!a || b < a)) best.set(k, { ...prev, ...e });
    }
  }

  return Array.from(best.values());
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const supabase = supabaseServer();

  const { data: sourcesData } = await supabase.from("sources").select("name,url").eq("is_active", true);
  const sources = (sourcesData ?? []) as SourceRow[];

  const city = firstParam(sp.city).trim();
  const category = firstParam(sp.category).trim().toLowerCase();
  
  const categoryDb = category; // UI->DB (no remap)
const price = firstParam(sp.price).trim();
  const month = firstParam((sp as any).month).trim(); // YYYY-MM

  const PAGE_SIZE = 50;

  const rawPage = firstParam((sp as any).page).trim();
  const page = Math.max(1, Number(rawPage || "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  if (DEBUG) console.log("[FILTER PARAMS]", { city, category, price, month });

  const now = new Date();
  const nowISO = (() => {
    const TZ = "Europe/Stockholm";
    const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = fmt.formatToParts(now);
    const y = Number(parts.find(p => p.type === "year")?.value);
    const m = Number(parts.find(p => p.type === "month")?.value);
    const d = Number(parts.find(p => p.type === "day")?.value);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
  })();
  // Month filter (YYYY-MM). Default: current month.
  const defaultMonth = String(now.getFullYear()) + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const ym = (month === "all")
    ? "all"
    : ((month && /^\d{4}-\d{2}$/.test(month)) ? month : defaultMonth);

  const ymAll = ym === "all";
  const y = ymAll ? 0 : Number(ym.slice(0, 4));
  const mm = ymAll ? 0 : Number(ym.slice(5, 7)); // 1..12
  const monthStartISO = ymAll ? null : new Date(Date.UTC(y, mm - 1, 1, 0, 0, 0)).toISOString();
  const monthEndISO   = ymAll ? null : new Date(Date.UTC(y, mm, 1, 0, 0, 0)).toISOString();

  // Build deterministic month options on the server (avoids hydration mismatch in client components)
  const buildMonthOptions = (y0: number, m0: number) => {
    const out: { value: string; label: string }[] = [];
    out.push({ value: "all", label: "Alla månader" });

    const TZ = "Europe/Stockholm";
    const fmtLabel = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric", timeZone: TZ });

    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(y0, m0 + i, 1, 0, 0, 0));
      const yy = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const value = `${yy}-${m}`;
      const label = fmtLabel.format(d);
      out.push({ value, label });
    }
    return out;
  };

  const monthOptions = buildMonthOptions(now.getFullYear(), now.getMonth());

  // Count query (for pagination) — do NOT combine with range()
  let countQ = supabase
    .from("public_events_with_cta")
    .select("id", { count: "exact", head: true })
    .gte("start_at", nowISO); // hide past events

  if (city) countQ = countQ.ilike("city", city);
  if (price === "free" || price === "paid") countQ = countQ.eq("price_type", price);
  if (monthStartISO && monthEndISO) countQ = countQ.gte("start_at", monthStartISO).lt("start_at", monthEndISO);
  if (categoryDb) {
    if (categoryDb === "familj") countQ = countQ.eq("audience", "familj");
    else countQ = countQ.eq("category", categoryDb);
  }

  const { count, error: countError } = await countQ;

  let q = supabase
    .from("public_events_with_cta")
    .select("*")
    .gte("start_at", nowISO) // hide past events
    .order("start_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  if (city) q = q.ilike("city", city);
  if (price === "free" || price === "paid") q = q.eq("price_type", price);
  if (monthStartISO && monthEndISO) q = q.gte("start_at", monthStartISO).lt("start_at", monthEndISO);
  if (categoryDb) {
    if (categoryDb === "familj") q = q.eq("audience", "familj");
    else q = q.eq("category", categoryDb);
  }

  const { data, error } = await q;
  if (DEBUG) {
    const sample = (data || []).slice(0, 3);
    console.log("[IMG_SAMPLE]", sample.map((e:any)=>({id:e.id,title:(e.title||"").slice(0,60), image_url:e.image_url, best: bestImageSrc(e)})));
  }
  const _countError = countError;
  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 pb-24">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-3xl font-semibold tracking-tight">vadskavihittapå.nu</h1>
          <p className="mt-2 text-sm text-slate-600">Kunde inte hämta events.</p>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-white p-4 text-xs ring-1 ring-slate-200">
            {JSON.stringify(error, null, 2)}
          </pre>
        </div>
      </main>
    );
  }


  // Build city options from ALL matching future events (not just current page),
  // so the city dropdown always contains every city we have events for.
  let cityQ = supabase
    .from("public_events_with_cta")
    .select("city,metro_city")
    .gte("start_at", nowISO);

  if (price === "free" || price === "paid") cityQ = cityQ.eq("price_type", price);
  if (monthStartISO && monthEndISO) cityQ = cityQ.gte("start_at", monthStartISO).lt("start_at", monthEndISO);

  // NOTE: category filter is currently not applied to main query in this file;
  // keep in sync here if/when you add it to q.
  const { data: cityRows } = await cityQ.limit(5000);

  const events = (data ?? []) as EventRow[];
  const eventsDeduped = (dedupeEventsForList(events) as EventRow[]);

// Category filtering is applied in the DB query (keeps pagination/count deterministic)
const eventsForList = (eventsDeduped as EventRow[]);

const total = count ?? 0;
const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
const hasPrev = page > 1;
const hasNext = page < totalPages;


  // === Sponsorships (server-side) ===
  const nowTs = new Date().toISOString();

  // 2 slots: 1) hero under hero-sektionen  2) infeed-banner längre ner
  const { data: heroSponsRows } = await supabase
    .from("sponsorships")
    .select("id, package, placement, event_id, title, image_url, cta_url, starts_at, ends_at, priority, is_active")
    .eq("is_active", true)
    .eq("placement", "hero_banner")
    .lte("starts_at", nowTs)
    .gte("ends_at", nowTs)
    .order("priority", { ascending: true })
    .limit(2);

  const heroSponsorship = (heroSponsRows?.[0] ?? null) as any;
  const infeedSponsorship = (heroSponsRows?.[1] ?? null) as any;

  // Topplistan (3 slots)
  const { data: topSponsRows } = await supabase
    .from("sponsorships")
    .select("id, package, placement, event_id, title, image_url, cta_url, starts_at, ends_at, priority, is_active")
    .eq("is_active", true)
    .eq("placement", "listing_top")
    .lte("starts_at", nowTs)
    .gte("ends_at", nowTs)
    .order("priority", { ascending: true })
    .limit(3);

  const topSponsorships = (topSponsRows ?? []) as any[];


  const sponsorEventIds = Array.from(
    new Set(
      [
        heroSponsorship?.event_id,
        infeedSponsorship?.event_id,
        ...topSponsorships.map((x) => x?.event_id),
      ].filter(Boolean)
    )
  ) as string[];

  const { data: sponsorEventsRaw } = sponsorEventIds.length
    ? await supabase
        .from("public_events_with_cta")
    .select("*")
    .gte("start_at", nowISO) // hide past events
        .in("id", sponsorEventIds)
    : ({ data: [] as any[] } as any);

  const sponsorEventsById = new Map<string, any>(
    (sponsorEventsRaw ?? []).map((e: any) => [String(e.id), e])
  );

  const heroEvent = heroSponsorship?.event_id
    ? (sponsorEventsById.get(String(heroSponsorship.event_id)) ?? null)
    : null;

  const infeedEvent = infeedSponsorship?.event_id
    ? (sponsorEventsById.get(String(infeedSponsorship.event_id)) ?? null)
    : null;




const INFEED_AFTER = 9;
const infeedItems: any[] = (() => {
  const out: any[] = [...eventsForList];
  if (infeedSponsorship && out.length > INFEED_AFTER) {
    out.splice(INFEED_AFTER, 0, { __kind: "infeed_sponsor" });
  }
  return out;
})();

const topSponsored = topSponsorships
    .map((sp) => ({
      sp,
      ev: sponsorEventsById.get(String(sp.event_id)),
    }))
    .filter((x) => Boolean(x.ev));

  const normalizeCityOption = (raw: string) => {
    let x = String(raw || "").trim();
    if (!x) return "";
    // If it's "Venue, City" -> keep last segment
    if (x.includes(",")) x = x.split(",").at(-1)!.trim();

    const low = x.toLowerCase();

    // Filter out obvious venue/place words (not cities)
    const badTokens = [
      "kyrka", "kyrkan",
      "teater", "teatern",
      "scen", "scenen",
      "arena", "hallen", "hall", "stadion",
      "kulturhus", "kulturhuset",
      "museum", "bibliotek",
      "torget", "torg",
      "centrum", "galleria",
      "parken", "park",
      "church", "theatre", "arena",
    ];
    for (const t of badTokens) {
      if (low.includes(t)) return "";
    }

    // Too long -> likely not a city label
    if (x.length > 32) return "";

    return x;
  };

  const cityOptionsRaw = (cityRows ?? events ?? []).map((e: any) => {
    const mc = String(e.metro_city ?? "").trim();
    if (mc) return mc; // metro_city is authoritative "stad"
    return String(e.city ?? "").trim();
  });

  const cities = Array.from(SWEDISH_CITIES);
  if (DEBUG) console.log("[FILTER]", { city, category, price, ym, rows: events.length });

  const currentQS = new URLSearchParams();
  if (city) currentQS.set("city", city);
  if (category) currentQS.set("category", category);
  if (price) currentQS.set("price", price);
  if (ym) currentQS.set("month", ym);
  if (page > 1) currentQS.set("page", String(page));

  const hrefAll = buildHref(currentQS, { price: "" });
  const hrefFree = buildHref(currentQS, { price: "free" });
  const hrefPaid = buildHref(currentQS, { price: "paid" });

  const activeFiltersText =
    (city ? `stad=${city} ` : "") +
    (category ? `kategori=${category} ` : "") +
    (price ? `pris=${price} ` : "") +
    (ym ? `månad=${ym}` : "");

  const TZ = "Europe/Stockholm";
  const fmtDay = new Intl.DateTimeFormat("sv-SE", { day: "2-digit", timeZone: TZ });
  const fmtMonNum = new Intl.DateTimeFormat("sv-SE", { month: "2-digit", timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  
const MONTHS_SV = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
const monthShort = (dt: Date) => {
  const mm = Number(fmtMonNum.format(dt)); // 1..12, i Europe/Stockholm
  return MONTHS_SV[(mm || 1) - 1] || "jan";
};

const safeDate = (raw: string) => {
  let iso = String(raw || "").trim();
  if (!iso) return null;

  // Normalisera Postgres-timestamps för samma parsing i Node + browser:
  // "YYYY-MM-DD HH:MM:SS+00" -> "YYYY-MM-DDTHH:MM:SS+00:00"
  if (iso.includes(" ") && !iso.includes("T")) {
    iso = iso.replace(" ", "T");
  }

  // Om timestamp saknar timezone (vanligt i views): tvinga UTC för determinism
  // "YYYY-MM-DDTHH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) {
    iso = iso + "Z";
  }

  // "+00" -> "+00:00"
  if (/[+-]\\d{2}$/.test(iso)) {
    iso = iso + ":00";
  }

  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt;
};

return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm" />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">vadskavihittapå.nu</div>
              <div className="text-xs text-slate-600">Allt som händer. På ett ställe.</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">MVP: Stockholm</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">{sources.length} aktiva källor</span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <Hero />
      {heroSponsorship ? (
        <section className="mx-auto max-w-6xl px-6 pt-4">
          <div className="rounded-3xl bg-white ring-2 ring-slate-900/10 shadow-xl overflow-hidden">
            <a
              href={String(heroSponsorship.cta_url || heroEvent?.ticket_url || heroEvent?.source_url || "#")}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <div className="flex flex-col sm:flex-row">
                <div className="sm:w-72 w-full bg-slate-50 relative">
                  <img
                    src={String(
                      heroSponsorship.image_url ||
                      heroEvent?.image_url ||
                      bestImageSrc(heroEvent || { category: "övrigt" })
                    )}
                    alt={String(heroSponsorship.title || heroEvent?.title || "Sponsrat")}
                    className="h-56 w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 rounded-full bg-slate-900/90 px-3 py-1 text-xs font-semibold text-white">
                    Partner (P4)
                  </div>
                </div>
                <div className="p-7 flex-1">
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    Sponsrat · Partner (P4)
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {String(heroSponsorship.title || heroEvent?.title || "Sponsrat")}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Partnerplacering: hero-banner
                  </div>
                </div>
              </div>
            </a>
          </div>
        </section>
      ) : null}

      {/* Content */}

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-6">
          
          {/* List */}
          <section className="bg-transparent" suppressHydrationWarning>
            <div id="list" />

            <div className="flex items-end justify-between">
              <div>
                <div id="list" />
                <h2 className="text-sm font-semibold">Kommande events</h2>
                <p className="mt-1 text-xs text-slate-600">{eventsForList.length} visade (max 50)</p>

    <div className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
      <a
        href={hrefAll}
        className={
          "px-3 py-1.5 text-xs font-semibold rounded-xl transition " +
          (!price ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50")
        }
      >
        Alla
      </a>
      <a
        href={hrefFree}
        className={
          "px-3 py-1.5 text-xs font-semibold rounded-xl transition " +
          (price === "free" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50")
        }
      >
        Gratis
      </a>
      <a
        href={hrefPaid}
        className={
          "px-3 py-1.5 text-xs font-semibold rounded-xl transition " +
          (price === "paid" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50")
        }
      >
        Betal
      </a>
    </div>

                <div className="mt-3 flex items-center gap-2">
                  <a
                    className={`rounded-md border px-3 py-2 text-xs ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
                    href={buildHref(currentQS, { page: String(Math.max(1, page - 1)) })}
                  >
                    Föregående
                  </a>
                  <a
                    className={`rounded-md border px-3 py-2 text-xs ${!hasNext ? "pointer-events-none opacity-50" : ""}`}
                    href={buildHref(currentQS, { page: String(page + 1) })}
                  >
                    Nästa
                  </a>
                </div>
              </div>
            </div>


            {topSponsored.length ? (
              <div className="mt-6">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">Sponsrade</h3>
                  <span className="text-xs text-slate-500">Topplista</span>
                </div>
                <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="list">
                  {topSponsored.map((x: any, i: number) => (
                    <div role="listitem" key={String(x.ev.id) + "-" + i} className="list-none">
                      <a
                        href={String(x.ev.ticket_url || x.ev.source_url || "#")}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden hover:bg-slate-50"
                      >
                        <img
                          src={String(bestImageSrc(x.ev))}
                          alt={String(x.ev.title || "Sponsrat")}
                          className="h-36 w-full object-cover"
                          loading="lazy"
                        />
                        <div className="p-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Sponsrat
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {String(x.sp.package || "").toUpperCase()} {String(x.sp.package || "") === "P4" ? "Partner" : "Topplista"}
                          </div>
                          <div className="mt-1 text-base font-semibold tracking-tight text-slate-900">
                            {String(x.ev.title || "Sponsrat")}
                          </div>
                          <div className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white">
                            Gå till event
                          </div>
                        </div>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="list">

              {eventsForList.length === 0 ? (

                <div role="listitem" className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 text-sm text-slate-700">

                  Inga kommande events hittades för valda filter.

                </div>

              ) : (

                infeedItems.map((e: any) => {
                  if (e && e.__kind === "infeed_sponsor") {
                    const href = String(infeedSponsorship?.cta_url || infeedEvent?.ticket_url || infeedEvent?.source_url || "#");
                    const img = String(
                      infeedSponsorship?.image_url ||
                        infeedEvent?.image_url ||
                        bestImageSrc(infeedEvent || { category: "övrigt" })
                    );
                    const title = String(infeedSponsorship?.title || infeedEvent?.title || "Sponsrat");
                    return (
                      <div role="listitem" key="infeed-sponsor" className="sm:col-span-2 lg:col-span-3">
                        <div className="rounded-3xl bg-white ring-2 ring-slate-900/10 shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:-translate-y-0.5">
                          <a href={href} target="_blank" rel="noreferrer" className="block">
                            <div className="flex flex-col sm:flex-row">
                              <div className="sm:w-72 w-full bg-slate-50 relative">
                                <img src={img} alt={title} className="h-56 w-full object-cover" loading="lazy" />
                      <div className="PARTNER-BADGE absolute top-3 left-3 rounded-full bg-slate-900/90 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-white/20">
                        Partner (P4)
                      </div>
                      </div>
                              <div className="p-7 flex-1 bg-gradient-to-br from-white via-white to-slate-50">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Sponsrat · Partner (P4)
                                </div>
                                <div className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                                  {title}
                                </div>
                                <div className="mt-2 text-sm text-slate-600">
                                  Partnerplacering i flödet
                                </div>
                                <div className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.99]">
                                  Gå till event
                                </div>
                              </div>
                            </div>
                          </a>
                        </div>
                      </div>
                    );
                  }



                  const dt = safeDate(e.start_at);
                  if (!dt) return null;

                  const day = fmtDay.format(dt);

                  const mon = monthShort(dt).replace(".", "");

                  const time = fmtTime.format(dt);

            

                  const srcLabel = sourceLabelForEvent(e, sources);

                  const venue = isCoordLikeVenue(e.venue_name) ? "Okänt" : (e.venue_name || "Okänt");

                  const cityLabel = e.city || "—";

                  let displayTitle = e.title;
if (/guid/i.test(e.title||"") && /goteborg/i.test(e.venue_name||"")) {
  displayTitle = "Guidade turer på GöteborgsOperan";
}
const titleParts = splitEventTitle(displayTitle);

const isGuidedTour = /guid|tur/i.test(String(e.title || "")) && /göteborgsoperan/i.test(String(e.venue_name || ""));
let imgSrc = bestImageSrc(e);
if (isGuidedTour && (!e.image_url || String(e.image_url).trim() === "")) {
  imgSrc = "/img/goteborgsoperan.jpg";
}

                  const cta = primaryCtaUrl(e);

            

                  return (

                    <div role="listitem"

                      key={String(e.id || "") + "__" + String(e.start_at || "") + "__" + String(e.ticket_url || e.source_url || "")}

                      className="group rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-0.5 hover:border-slate-300 transition-all duration-300 cursor-pointer overflow-hidden"

                    >

                      <div className="p-5 grid gap-4">

                        
                        <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-slate-200">
                          <img
                            src={imgSrc}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
/>

                          {/* Datum overlay */}
                          <div className="absolute bottom-3 left-3 rounded-2xl bg-black/75 px-3 py-2 text-white shadow-lg backdrop-blur-md">
                            <div className="text-lg font-bold leading-none">
                              {day} {mon}
                            </div>
                            <div className="text-xs tracking-wide opacity-90">
                              kl {time}
                            </div>
                          </div>
                        </div>

            

                        <div className="min-w-0 flex-1">

                          <div className="flex flex-wrap items-center gap-2">

                            <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 " + chipClass("cat", effectiveCategory(e))}>

                              {categoryLabel(effectiveCategory(e))}

                            </span>

                            {isMusicalEvent(e) ? (
                              <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 bg-violet-50 text-violet-800 ring-violet-200"}>
                                Musikal
                              </span>
                            ) : null}

                            {isStandupEvent(e) ? (
                              <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 bg-slate-50 text-slate-800 ring-slate-200"}>
                                Standup
                              </span>
                            ) : null}

                            {!isMusicalEvent(e) && isOperaEvent(e) ? (
                              <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 bg-amber-50 text-amber-900 ring-amber-200"}>
                                Opera
                              </span>
                            ) : null}


                            {e.audience === "familj" ? (
                              <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 " + chipClass("cat", "familj")}>
                                Familj
                              </span>
                            ) : null}

                            <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 " + chipClass("muted")}>

                              {venue}

                            </span>

                            <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 " + chipClass("muted")}>

                              {cityLabel}

                            </span>

                          </div>

            

                          <div className="mt-3 text-lg font-semibold leading-snug">

                            {titleParts.main}{titleParts.sub ? (<span className="mt-1 block text-sm text-slate-600 break-words">{titleParts.sub}</span>) : null}


                          </div>

            

                          <div className="mt-1 text-sm text-slate-600">

                            {e.description_text ? String(e.description_text).replace(/\s+/g," ").trim().slice(0,220) : "—"}

                          </div>

            

                          <div className="mt-3 text-sm text-slate-500">

                            Mer info via {srcLabel}

                          </div>

            

                          <div className="mt-4 flex flex-wrap items-center gap-2">

                            {cta ? (

                              <a

                                href={cta}

                                target="_blank"

                                rel="noreferrer"

                                className="inline-flex h-10 items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-sky-700"

                              >

                                Biljetter

                              </a>

                            ) : null}

            

                            {(() => {
                              const more = e.source_url
                                ? primaryCtaUrl({ ...e, ticket_url: null, organizer_url: e.source_url, source_url: null })
                                : null;
                              return more ? (
                                <a
                                  href={more}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
                                >
                                  Läs mer
                                </a>
                              ) : null;
                            })()}

                          </div>

                        </div>

                      </div>

                    </div>

                  );

                })

              )}

            </div>
</section>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="flex items-center justify-center gap-2">
          <a
            className={`rounded-md border px-3 py-2 text-xs ${!hasPrev ? "pointer-events-none opacity-50" : ""}`}
            href={buildHref(currentQS, { page: String(Math.max(1, page - 1)) })}
          >
            Föregående
          </a>
          <div className="px-2 text-xs text-slate-600">
            Sida {page} av {totalPages}
          </div>
          <a
            className={`rounded-md border px-3 py-2 text-xs ${!hasNext ? "pointer-events-none opacity-50" : ""}`}
            href={buildHref(currentQS, { page: String(page + 1) })}
          >
            Nästa
          </a>
        </div>
      </div>

      {/* Skapar du events? */}
      <section className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">
            Skapar du events?
          </h2>

          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            vadskavihittapå.nu samlar publik som letar efter upplevelser.
            Om ditt event inte syns här ännu – hör av dig.
          </p>

          <ul className="mt-4 grid gap-2 text-sm text-slate-700">
            <li>• Ditt event syns där folk redan letar</li>
            <li>• Ingen administration – vi uppdaterar automatiskt</li>
            <li>• Gratis att vara med under MVP-fasen</li>
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href="mailto:hello.nu?subject=Tips%20om%20event"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200"
            >
              Tipsa oss om ditt event
            </a>
            <span className="text-xs text-slate-500">
              (länk, feed eller bara ett mejl räcker)
            </span>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-slate-500 flex flex-wrap gap-2 justify-between">
          <span>© vadskavihittapå.nu (MVP)</span>
          <span>Data från flera källor, uppdateras automatiskt</span>
        </div>
      </footer>

      {/* Bottom filters */}
<BottomFilterBar cities={cities} monthOptions={monthOptions} />

    </main>
  );
}

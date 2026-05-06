import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseIntent, type Intent } from "@/lib/ai/paco/intent";
import {
  buildWhy,
  formatAgeList,
  inferChildAgeFit,
  inferFamilyAudienceFromEvent,
  inferFunnyEvent,
  inferStandupEvent,
} from "@/lib/ai/paco/explain";
import { retrieveCandidates, type PacoEventRow } from "@/lib/ai/paco/retrieve";
import { decidePacoMode } from "@/lib/ai/paco/mode";
import { buildSimilarSourceProfile, rankCandidates } from "@/lib/ai/paco/rank";
import { composePacoReply } from "@/lib/ai/paco/reply";


type EventRow = {
  id: string;
  title: string | null;
  description: string | null;
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

function sanitizeDesc(input: string | null) {
  let t = (input ?? "").trim();
  if (!t) return "";

  t = t.replace(/<!--([\s\S]*?)-->/g, " ");

  const junk = [
    "Det verkar inte som att din webbläsare har JavaScript aktiverat",
    "vilket behövs för att använda den här siten",
    "Logga in",
    "Mitt konto",
  ];
  for (const j of junk) t = t.replaceAll(j, " ");

  t = t.replace(/\s+/g, " ").trim();

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
  return title + "__" + String(e.start_at).slice(0, 10);
}

function scoreEventForList(e: any) {
  let score = 0;
  if (primaryCtaUrl(e)) score += 100;
  if (e.image_url) score += 30;

  const cat = (e.category || "").toLowerCase();
  if (cat && cat !== "ovrigt" && cat !== "övrigt" && cat !== "familj") score += 10;

  if ((e.audience || "").toLowerCase() === "familj") score += 5;

  const dlen = (sanitizeDesc(e.description_text || e.description || null) || "").length;
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

    const audPrev = (prev.audience || "").toLowerCase();
    const audCur = (e.audience || "").toLowerCase();
    if (audPrev !== "familj" && audCur === "familj") prev.audience = "familj";

    const cPrev = (prev.category || "").toLowerCase();
    const cCur = (e.category || "").toLowerCase();
    if (isOvr(cPrev) && !isOvr(cCur)) prev.category = e.category;

    const sp = scoreEventForList(prev);
    const sc = scoreEventForList(e);
    if (sc > sp) {
      best.set(k, { ...prev, ...e });
    } else if (sc === sp) {
      const a = String(prev.start_at || "");
      const b = String(e.start_at || "");
      if (b && (!a || b < a)) best.set(k, { ...prev, ...e });
    }
  }

  return Array.from(best.values());
}

function buildSimilarFallbackSuggestions(args: {
  city: string;
  entityLabel: string | null;
  similarKind: "family" | null;
  similarProfileCategory?: string | null;
  similarProfileSubcategory?: string | null;
}) {
  const city = args.city || "Stockholm";
  const label = String(args.entityLabel || "").trim();
  const sub = String(args.similarProfileSubcategory || "").toLowerCase();
  const cat = String(args.similarProfileCategory || "").toLowerCase();

  if (args.similarKind === "family") {
    const suggestions = [
      {
        label: `Visa andra familjeevent i ${city}`,
        query: `Visa andra familjeevent i ${city}.`,
      },
      {
        label: `Visa barnteater i ${city}`,
        query: `Visa barnteater i ${city}.`,
      },
      {
        label: `Visa familjekonserter i ${city}`,
        query: `Visa familjekonserter i ${city}.`,
      },
      {
        label: `Visa familjeevent nästa helg i ${city}`,
        query: `Visa familjeevent nästa helg i ${city}.`,
      },
    ];

    if (sub === "teater" || cat === "teater") suggestions[1] = {
      label: `Visa fler barnföreställningar i ${city}`,
      query: `Visa barnföreställningar i ${city}.`,
    };

    if (sub === "konsert" || cat === "musik") suggestions[2] = {
      label: `Visa fler familjekonserter i ${city}`,
      query: `Visa fler familjekonserter i ${city}.`,
    };

    return suggestions;
  }

  return [
    {
      label: `Visa andra event i ${city}`,
      query: `Visa andra event i ${city}.`,
    },
    {
      label: `Visa populära event i ${city}`,
      query: `Visa populära event i ${city}.`,
    },
    {
      label: `Visa event nästa helg i ${city}`,
      query: `Visa event nästa helg i ${city}.`,
    },
    label
      ? {
          label: `Visa event med liknande ton som ${label}`,
          query: `Visa event som liknar ${label} i ${city}.`,
        }
      : {
          label: `Visa fler sceniska event i ${city}`,
          query: `Visa sceniska event i ${city}.`,
        },
  ];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || "").trim();

    if (!query) {
      return NextResponse.json({ ok: false, error: "missing_query" }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRole) {
      return NextResponse.json({ ok: false, error: "missing_env" }, { status: 500 });
    }

    const intent = parseIntent(query);
    const modeDecision = decidePacoMode(query, intent);

    if (modeDecision.mode === "chat" || modeDecision.mode === "ask_clarifying_question") {
      return NextResponse.json(
        {
          ok: true,
          mode: modeDecision.mode,
          reply: modeDecision.reply,
          results: [],
          meta: {
            stage: modeDecision.mode,
            note: null,
            result_count: 0,
          },
        },
        { status: 200 }
      );
    }
    const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

    const retrieval = await retrieveCandidates({
      supabase,
      intent,
      dedupeEventsForList,
    });

    if (retrieval.error) {
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }

    const eventsRaw = retrieval.eventsRaw as PacoEventRow[];
    const events = retrieval.events as PacoEventRow[];
    const eventsTimeFiltered = retrieval.eventsTimeFiltered as PacoEventRow[];
    const price_filter_relaxed = retrieval.price_filter_relaxed;
    const audience_filter_relaxed = retrieval.audience_filter_relaxed;

    const eventIds = Array.from(new Set(eventsTimeFiltered.map((e) => String(e.id)).filter(Boolean)));

    const clicksSinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentClicks } = eventIds.length
      ? await supabase
          .from("clicks")
          .select("event_id,created_at")
          .in("event_id", eventIds)
          .gte("created_at", clicksSinceISO)
          .order("created_at", { ascending: false })
          .limit(5000)
      : ({ data: [] as any[] } as any);

    const clickCountByEvent = new Map<string, number>();
    for (const row of (recentClicks ?? []) as any[]) {
      const id = String(row?.event_id || "");
      if (!id) continue;
      clickCountByEvent.set(id, (clickCountByEvent.get(id) || 0) + 1);
    }

    const { data: reviewsRaw } = eventIds.length
      ? await supabase
          .from("reviews")
          .select("event_id,rating,text,created_at")
          .in("event_id", eventIds)
          .order("created_at", { ascending: false })
          .limit(5000)
      : ({ data: [] as any[] } as any);

    const reviewStatsByEvent = new Map<string, { count: number; avg: number | null }>();
    for (const [eventId, rows] of Object.entries(
      (reviewsRaw || []).reduce((acc: Record<string, any[]>, row: any) => {
        const id = String(row?.event_id || "");
        if (!id) return acc;
        (acc[id] ||= []).push(row);
        return acc;
      }, {})
    )) {
      const list = rows as any[];
      const count = list.length;
      const avg = count ? list.reduce((sum, r) => sum + Number(r?.rating || 0), 0) / count : 0;
      reviewStatsByEvent.set(String(eventId), {
        count,
        avg: count ? Number(avg.toFixed(1)) : null,
      });
    }

    let similarSourceProfile = null;
    let similarDebug: any = null;

    if (intent.similar_to) {
      const sourceIntent: Intent = {
        ...intent,
        search_text: intent.similar_to,
        similar_to: null,
        similar_kind: null,
        similar_profile: null,
        requested_count: 5,
      };

      const sourceRetrieval = await retrieveCandidates({
        supabase,
        intent: sourceIntent,
        dedupeEventsForList,
      });

      if (!sourceRetrieval.error) {
        const sourceIds = Array.from(new Set(sourceRetrieval.eventsTimeFiltered.map((e) => String(e.id)).filter(Boolean)));

        const sourceClicksSinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data: sourceRecentClicks } = sourceIds.length
          ? await supabase
              .from("clicks")
              .select("event_id,created_at")
              .in("event_id", sourceIds)
              .gte("created_at", sourceClicksSinceISO)
              .order("created_at", { ascending: false })
              .limit(5000)
          : ({ data: [] as any[] } as any);

        const sourceClickCountByEvent = new Map<string, number>();
        for (const row of (sourceRecentClicks ?? []) as any[]) {
          const id = String(row?.event_id || "");
          if (!id) continue;
          sourceClickCountByEvent.set(id, (sourceClickCountByEvent.get(id) || 0) + 1);
        }

        const { data: sourceReviewsRaw } = sourceIds.length
          ? await supabase
              .from("reviews")
              .select("event_id,rating,text,created_at")
              .in("event_id", sourceIds)
              .order("created_at", { ascending: false })
              .limit(5000)
          : ({ data: [] as any[] } as any);

        const sourceReviewStatsByEvent = new Map<string, { count: number; avg: number | null }>();
        for (const [eventId, rows] of Object.entries(
          (sourceReviewsRaw || []).reduce((acc: Record<string, any[]>, row: any) => {
            const id = String(row?.event_id || "");
            if (!id) return acc;
            (acc[id] ||= []).push(row);
            return acc;
          }, {})
        )) {
          const list = rows as any[];
          const count = list.length;
          const avg = count ? list.reduce((sum, r) => sum + Number(r?.rating || 0), 0) / count : 0;
          sourceReviewStatsByEvent.set(String(eventId), {
            count,
            avg: count ? Number(avg.toFixed(1)) : null,
          });
        }

        const sourceRankedResult = rankCandidates({
          events: sourceRetrieval.eventsTimeFiltered,
          intent: sourceIntent,
          clickCountByEvent: sourceClickCountByEvent,
          reviewStatsByEvent: sourceReviewStatsByEvent,
        });
        const sourceTop = sourceRankedResult.ranked[0];
        similarDebug = {
          similar_to: intent.similar_to,
          source_candidates: sourceRankedResult.ranked.slice(0, 5).map((e) => ({
            title: e.title,
            city: e.city,
            category: e.category,
            subcategory: e.subcategory,
            audience: e.audience,
            score: e.score,
          })),
          source_top: sourceTop
            ? {
                title: sourceTop.title,
                city: sourceTop.city,
                category: sourceTop.category,
                subcategory: sourceTop.subcategory,
                audience: sourceTop.audience,
                score: sourceTop.score,
              }
            : null,
        };
        if (sourceTop) {
          similarSourceProfile = buildSimilarSourceProfile(intent.similar_to, sourceTop);
        }
      }
    }

    const {
      ranked,
      usedFamilyNearbyFallback,
      usedFunnyNearbyFallback,
      hasReviewedRankedResults,
      familyDebug,
    } = rankCandidates({
      events: eventsTimeFiltered,
      intent,
      clickCountByEvent,
      reviewStatsByEvent,
      similarSourceProfile,
    });

    const suggestionCity = intent.city || "Stockholm";
    const isEntitySearch = modeDecision.mode === "search_entity";
    const isSimilarSearch = modeDecision.mode === "similar";
    const entityLabel = intent.search_text || intent.similar_to;

    const followUpSuggestions =
      isSimilarSearch
        ? ranked.length === 0
          ? buildSimilarFallbackSuggestions({
              city: suggestionCity,
              entityLabel: entityLabel || null,
              similarKind: intent.similar_kind,
              similarProfileCategory: similarSourceProfile?.category || null,
              similarProfileSubcategory: similarSourceProfile?.subcategory || null,
            })
          : [
              {
                label: intent.similar_kind === "family" ? `Visa andra familjeevent i ${suggestionCity}` : `Visa barnvänliga sceniska event i ${suggestionCity}`,
                query: intent.similar_kind === "family" ? `Visa andra familjeevent i ${suggestionCity}.` : `Visa barnvänliga sceniska event i ${suggestionCity}.`,
              },
              {
                label: intent.similar_kind === "family" ? `Visa barnteater i ${suggestionCity}` : `Visa liknande familjeshower i ${suggestionCity}`,
                query: intent.similar_kind === "family" ? `Visa barnteater i ${suggestionCity}.` : `Visa liknande familjeshower i ${suggestionCity}.`,
              },
              {
                label: intent.similar_kind === "family" ? `Visa familjeevent nästa helg i ${suggestionCity}` : `Visa barnteater och familjekonserter i ${suggestionCity}`,
                query: intent.similar_kind === "family" ? `Visa familjeevent nästa helg i ${suggestionCity}.` : `Visa barnteater och familjekonserter i ${suggestionCity}.`,
              },
            ]
        : isEntitySearch
          ? ranked.length === 0
          ? buildSimilarFallbackSuggestions({
              city: suggestionCity,
              entityLabel: entityLabel || null,
              similarKind: intent.similar_kind,
              similarProfileCategory: similarSourceProfile?.category || null,
              similarProfileSubcategory: similarSourceProfile?.subcategory || null,
            })
          : ranked.length === 0
            ? [
                {
                  label: "Testa annan stavning",
                  query: `Visa event med ${entityLabel}.`,
                },
                {
                  label: `Visa event med ${entityLabel} i Stockholm`,
                  query: `Visa event med ${entityLabel} i Stockholm.`,
                },
                {
                  label: "Visa liknande familjeevent",
                  query: `Visa liknande familjeevent som ${entityLabel}.`,
                },
              ]
            : intent.similar_to
              ? [
                  {
                    label: intent.similar_kind === "family" ? `Visa andra familjeevent i ${suggestionCity}` : `Visa barnvänliga sceniska event i ${suggestionCity}`,
                    query: intent.similar_kind === "family" ? `Visa andra familjeevent i ${suggestionCity}.` : `Visa barnvänliga sceniska event i ${suggestionCity}.`,
                  },
                  {
                    label: intent.similar_kind === "family" ? `Visa barnteater i ${suggestionCity}` : `Visa liknande familjeshower i ${suggestionCity}`,
                    query: intent.similar_kind === "family" ? `Visa barnteater i ${suggestionCity}.` : `Visa liknande familjeshower i ${suggestionCity}.`,
                  },
                  {
                    label: intent.similar_kind === "family" ? `Visa familjeevent nästa helg i ${suggestionCity}` : `Visa barnteater och familjekonserter i ${suggestionCity}`,
                    query: intent.similar_kind === "family" ? `Visa familjeevent nästa helg i ${suggestionCity}.` : `Visa barnteater och familjekonserter i ${suggestionCity}.`,
                  },
                ]
              : [
                  {
                    label: `Visa liknande event som ${entityLabel}`,
                    query: `Visa liknande event som ${entityLabel}.`,
                  },
                  {
                    label: `Visa andra familjeevent i ${suggestionCity}`,
                    query: `Visa andra familjeevent i ${suggestionCity}.`,
                  },
                  {
                    label: `Visa barnteater i ${suggestionCity}`,
                    query: `Visa barnteater i ${suggestionCity}.`,
                  },
                ]
        : ranked.length === 0
        ? intent.mood === "funny" || intent.format === "standup"
          ? [
              {
                label: "Visa något roligt dagen efter",
                query: `Visa något roligt i ${suggestionCity} dagen efter.`,
              },
              {
                label: `Visa något roligt i ${suggestionCity} utan exakt datum`,
                query: `Visa något roligt i ${suggestionCity} utan exakt datum.`,
              },
              {
                label: "Visa andra bra kvällsevent samma helg",
                query: `Visa bra kvällsevent i ${suggestionCity} samma helg.`,
              },
            ]
          : intent.audience === "familj"
            ? [
                {
                  label: "Visa familjevent dagen efter",
                  query: `Visa familjevent i ${suggestionCity} dagen efter.`,
                },
                {
                  label: "Visa familjevent med bredare tider",
                  query: `Visa familjevent i ${suggestionCity} med bredare tider.`,
                },
                {
                  label: "Visa bara gratis familjevent",
                  query: `Visa gratis familjevent i ${suggestionCity}.`,
                },
              ]
            : intent.budget_max != null
              ? [
                  {
                    label: "Visa event med lite högre budget",
                    query: `Visa event i ${suggestionCity} med lite högre budget än ${intent.budget_max} kr.`,
                  },
                  {
                    label: "Visa gratis event samma datum",
                    query: `Visa gratis event i ${suggestionCity} samma datum.`,
                  },
                  {
                    label: "Visa event dagen efter",
                    query: `Visa event i ${suggestionCity} dagen efter.`,
                  },
                ]
              : [
                  {
                    label: "Visa närliggande datum",
                    query: `Visa event i ${suggestionCity} på närliggande datum.`,
                  },
                  {
                    label: "Visa kvällsevent i stället",
                    query: `Visa kvällsevent i ${suggestionCity}.`,
                  },
                  {
                    label: "Visa de mest populära alternativen",
                    query: `Visa de mest populära eventen i ${suggestionCity}.`,
                  },
                ]
        : usedFunnyNearbyFallback
          ? [
              {
                label: "Visa något roligt dagen efter",
                query: `Visa något roligt i ${suggestionCity} dagen efter.`,
              },
              {
                label: `Visa standup i ${suggestionCity}`,
                query: `Visa standup i ${suggestionCity}.`,
              },
              {
                label: "Visa fler alternativ samma helg",
                query: `Visa fler event i ${suggestionCity} samma helg.`,
              },
            ]
          : usedFamilyNearbyFallback
            ? [
                {
                  label: "Visa familjevent dagen efter",
                  query: `Visa familjevent i ${suggestionCity} dagen efter.`,
                },
                {
                  label: "Visa bredare åldersmatchningar",
                  query: `Visa familjevent i ${suggestionCity} för bredare åldrar.`,
                },
                {
                  label: "Visa gratis familjevent",
                  query: `Visa gratis familjevent i ${suggestionCity}.`,
                },
              ]
            : intent.format === "musical"
              ? [
                  {
                    label: `Visa fler musikaler i ${suggestionCity}`,
                    query: `Visa fler musikaler i ${suggestionCity}.`,
                  },
                  {
                    label: `Visa musikaler nästa helg i ${suggestionCity}`,
                    query: `Visa musikaler nästa helg i ${suggestionCity}.`,
                  },
                  {
                    label: `Visa sceniska kvällsevent i ${suggestionCity}`,
                    query: `Visa sceniska kvällsevent i ${suggestionCity}.`,
                  },
                ]
            : [];

    const note =
      isSimilarSearch
        ? intent.similar_kind === "family"
          ? ranked.length === 0
            ? `Jag hittar inga tydliga familjeevent med samma känsla som "${intent.similar_to}" just nu.`
            : ranked.length === 1
              ? `Jag hittade 1 familjeevent som liknar "${intent.similar_to}".`
              : `Jag hittade ${ranked.length} familjeevent som liknar "${intent.similar_to}".`
          : ranked.length === 0
            ? `Jag hittar inga tydliga event med samma känsla som "${intent.similar_to}" just nu.`
            : ranked.length === 1
              ? `Jag hittade 1 event som liknar "${intent.similar_to}".`
              : `Jag hittade ${ranked.length} event som liknar "${intent.similar_to}".`
        : isEntitySearch
          ? ranked.length === 0
            ? `Jag hittar inga event som tydligt matchar "${entityLabel}" just nu. Testa gärna annan stavning eller ett närliggande namn.`
            : ranked.length === 1
              ? `Jag hittade 1 tydlig träff för "${entityLabel}".`
              : `Jag hittade ${ranked.length} tydliga träffar för "${entityLabel}".`
        : ranked.length === 0
          ? intent.search_text
            ? `Jag hittar inga event som tydligt matchar "${entityLabel}" just nu. Testa gärna annan stavning eller ett närliggande namn.`
            : intent.mood === "funny" || intent.format === "standup"
            ? "Jag hittar inget tydligt roligt som matchar plats, datum och tid. Testa gärna närliggande datum eller en bredare tid samma helg."
            : intent.format === "musical"
            ? "Jag hittar ingen tydlig musikal som matchar plats och datum just nu. Testa gärna närliggande datum eller en bredare helg."
            : intent.audience === "familj"
            ? intent.children_ages.length > 0
              ? `Jag hittar inget exakt familjeevent som matchar plats, datum och tid för åldrarna ${formatAgeList(intent.children_ages)} år. Testa gärna närliggande tider eller dagen efter.`
              : "Jag hittar inga familjeevent som matchar plats, datum och tid just nu. Testa gärna närliggande tider eller datum."
            : intent.group_type === "couple"
              ? "Jag hittar inget tydligt som matchar plats, datum och tid för er som par. Testa gärna närliggande tider eller datum."
              : intent.group_type === "friends"
                ? "Jag hittar inget tydligt som matchar plats, datum och tid för ert sällskap. Testa gärna närliggande tider eller datum."
                : intent.group_type === "solo"
                  ? "Jag hittar inget tydligt som matchar plats, datum och tid för en person just nu. Testa gärna närliggande tider eller datum."
                  : intent.budget_max != null
                    ? `Jag hittar inget som matchar plats, datum, tid och budget under ${intent.budget_max} kr just nu. Testa gärna ett lite högre maxpris eller närliggande datum.`
                    : "Jag hittar inget exakt som matchar din fråga just nu. Testa gärna en stad, ett datum eller en ungefärlig tid så kan jag hjälpa dig vidare."
        : intent.format === "musical"
          ? ranked.length === 1
            ? "Jag hittade 1 musikal som matchar plats och datum."
            : `Jag hittade ${ranked.length} musikaler som matchar plats och datum.`
        : usedFunnyNearbyFallback
          ? "Jag hittade inget exakt som verkar roligt, men här är andra relevanta event samma datum."
          : usedFamilyNearbyFallback
            ? `Jag hittade inget exakt åldersmatchat för ${formatAgeList(intent.children_ages)} år, men här är barnvänliga familjeevent inom rätt datum och tid.`
            : intent.sort_by === "reviews" && !hasReviewedRankedResults
              ? "Det saknas recensioner för de aktuella träffarna, så listan visas utan verkligt recensionsunderlag."
              : price_filter_relaxed
                ? "Prisfilter släpptes eftersom prisdata saknas för matchande event."
                : audience_filter_relaxed
                  ? "Målgruppsfilter släpptes eftersom audience-data saknas för matchande event."
                  : null;

    const reply = composePacoReply({
      intent,
      results: ranked,
      note,
    });

    return NextResponse.json(
      {
        ok: true,
        intent,
        reply,
        results: ranked,
        meta: {
          stage: "ranked",
          price_filter_relaxed,
          audience_filter_relaxed,
          note,

          candidate_count_raw: eventsRaw.length,
          candidate_count_deduped: events.length,
          result_count: ranked.length,
          suggestions: followUpSuggestions,
        },
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

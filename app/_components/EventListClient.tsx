"use client";

import React from "react";

function looksBadImageUrl(u: string) {
  const s = (u || "").toLowerCase();
  if (!s) return true;
  if (s.includes("top.gif")) return true;
  if (s.includes("header")) return true;
  if (s.includes("logo")) return true;
  if (s.includes("sprite")) return true;
  if (s.includes("favicon")) return true;
  if (s.includes("apple-touch")) return true;
  if (s.includes("touch-icon")) return true;
  if (s.includes("manifest")) return true;
  if (/(^|\/)(icons?)(\/|$)/i.test(s)) return true;
  if (/(^|\/|[-_])icon([-_]|\.|$)/i.test(s)) return true;
  if (s.endsWith(".svg") && (s.includes("logo") || /(^|\/)(icons?)(\/|$)/i.test(s) || /(^|\/|[-_])icon([-_]|\.|$)/i.test(s))) return true;
  return false;
}

function fallbackImageForCategory(cat: string) {
  const c = (cat || "").toLowerCase();
  if (c === "teater" || c === "musikal") return "/placeholders/teater.svg";
  if (c === "musik") return "/placeholders/musik.svg";
  if (c === "dans") return "/placeholders/teater.svg";
  if (c === "standup") return "/placeholders/standup.svg";
  if (c === "familj") return "/placeholders/familj.svg";
  return "/placeholders/ovrigt.svg";
}

function effectiveCategory(e: any) {
  const c = String(e?.category || "").trim();
  if (c) return c;
  const a = String(e?.audience || "").toLowerCase();
  if (a === "familj") return "familj";
  return "övrigt";
}

function bestImageSrc(e: any) {
  let u = String((e?.image_url ?? "")).trim();

  // Normalize mixed content / protocol-relative
  if (u.startsWith("//")) u = "https:" + u;
  if (u.startsWith("http://")) {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const SAFE_HTTPS = new Set(["pygmeteatern.se", "malmolive.se", "cdn.dn-static.se"]);
      if (SAFE_HTTPS.has(host)) u = u.replace(/^http:\/\//i, "https://");
    } catch {}
  }

  if (u && !looksBadImageUrl(u)) return u;
  return fallbackImageForCategory(effectiveCategory(e));
}

function safeDate(raw: string) {
  let iso = String(raw || "").trim();
  if (!iso) return null;
  if (iso.includes(" ") && !iso.includes("T")) iso = iso.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) iso = iso + "Z";
  if (/[+-]\d{2}$/.test(iso)) iso = iso + ":00";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt;
}

export default function EventListClient(props: {
  infeedItems: any[];
  infeedSponsorship: any | null;
  infeedEvent: any | null;
  INFEED_AFTER: number;
}) {
  const { infeedItems, infeedSponsorship, infeedEvent } = props;

  const TZ = "Europe/Stockholm";
  const fmtDay = new Intl.DateTimeFormat("sv-SE", { day: "2-digit", timeZone: TZ });
  const fmtMonNum = new Intl.DateTimeFormat("sv-SE", { month: "2-digit", timeZone: TZ });
  const fmtTime = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  const MONTHS_SV = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
  const monthShort = (dt: Date) => {
    const mm = Number(fmtMonNum.format(dt));
    return MONTHS_SV[(mm || 1) - 1] || "jan";
  };

  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="list">
      {infeedItems.map((e: any, idx: number) => {
        if (e && e.__kind === "infeed_sponsor") {
          const href = String(infeedSponsorship?.cta_url || infeedEvent?.ticket_url || infeedEvent?.source_url || "#");
          const img = String(infeedSponsorship?.image_url || infeedEvent?.image_url || bestImageSrc(infeedEvent || { category: "övrigt" }));
          const title = String(infeedSponsorship?.title || infeedEvent?.title || "Sponsrat");
          return (
            <div role="listitem" key={"infeed-sponsor"} className="sm:col-span-2 lg:col-span-3">
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

        const dt = safeDate(e?.start_at);
        if (!dt) return null; // ok nu: NoSSR → ingen hydration mismatch

        const day = fmtDay.format(dt);
        const mon = monthShort(dt).replace(".", "");
        const time = fmtTime.format(dt);

        const href = String(e?.ticket_url || e?.organizer_url || e?.source_url || "#");
        const img = String(bestImageSrc(e || { category: "övrigt" }));
        const title = String(e?.title || "");
        const venue = String(e?.venue_name || e?.city || "");

        return (
          <div role="listitem" key={String(e?.id || idx)} className="list-none">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden hover:bg-slate-50"
            >
              <div className="relative h-40 w-full overflow-hidden bg-slate-200">
                <img
                  src={img}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
                <div className="absolute top-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-900 ring-1 ring-slate-900/10">
                  {day} {mon} · {time}
                </div>
              </div>

              <div className="p-5 grid gap-2">
                <div className="text-sm font-semibold leading-snug text-slate-900 line-clamp-2">{title}</div>
                <div className="text-[12px] text-slate-600 line-clamp-1">{venue}</div>
              </div>
            </a>
          </div>
        );
      })}
    </div>
  );
}

import { supabaseServer } from "../lib/supabaseServer";

type EventRow = {
  id: string;
  title: string | null;
  start_at: string;
  city: string | null;
  venue_name: string | null;
  category: string | null;
  price_type: "free" | "paid" | "unknown" | null;
  price_min: number | null;
  price_max: number | null;
  ticket_url: string | null;
  source_url: string | null;
};
type SourceRow = {
  name: string;
  url: string;
};

function badgeStyle() {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #444",
    fontSize: 12,
    opacity: 0.9,
    whiteSpace: "nowrap" as const,
  };
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

function formatPrice(e: EventRow) {
  if (e.price_type === "free") return "Gratis";
  if (e.price_type === "paid") {
    if (e.price_min != null && e.price_max != null && e.price_min !== e.price_max) {
      return `${e.price_min}–${e.price_max} kr`;
    }
    if (e.price_min != null) return `${e.price_min} kr`;
    return "Betald";
  }
  return "Okänt";
}

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

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = supabaseServer();
const { data: sourcesData } = await supabase
  .from("sources")
  .select("name,url")
  .eq("is_active", true);

const sources = (sourcesData ?? []) as SourceRow[];

  const city = firstParam(searchParams?.city).trim();
  const category = firstParam(searchParams?.category).trim();
  const price = firstParam(searchParams?.price).trim(); // free | paid | ""
  const daysRaw = firstParam(searchParams?.days).trim(); // "7" etc

  const now = new Date();
  const nowISO = now.toISOString();

  let untilISO: string | null = null;
  const days = Number(daysRaw);
  if (Number.isFinite(days) && days > 0 && days <= 365) {
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    untilISO = until.toISOString();
  }

  let q = supabase
    .from("events")
    .select("id,title,start_at,city,venue_name,category,price_type,price_min,price_max,ticket_url,source_url")
    .gte("start_at", nowISO)
    .order("start_at", { ascending: true })
    .limit(50);

  if (city) q = q.eq("city", city);
  if (category) q = q.eq("category", category);
  if (price == "free" || price == "paid") q = q.eq("price_type", price);
  if (untilISO) q = q.lte("start_at", untilISO);

  const { data, error } = await q;

  const currentQS = new URLSearchParams();
  if (city) currentQS.set("city", city);
  if (category) currentQS.set("category", category);
  if (price) currentQS.set("price", price);
  if (daysRaw) currentQS.set("days", daysRaw);

  const hrefAll = buildHref(currentQS, { price: "" });
  const hrefFree = buildHref(currentQS, { price: "free" });
  const hrefPaid = buildHref(currentQS, { price: "paid" });

  if (error) {
    return (
      <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
        <h1>Sverige Event</h1>
        <p>Kunde inte hämta events.</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(error, null, 2)}</pre>
      </main>
    );
  }

  const events = (data ?? []) as EventRow[];

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1>Sverige Event</h1>
      <p>Kommande events (max 50)</p>

      <section style={{ border: "1px solid #333", borderRadius: 12, padding: 12, margin: "16px 0" }}>
        <form method="GET" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Stad</span>
              <input
                name="city"
                defaultValue={city}
                placeholder="Stockholm"
                style={{ padding: 10, borderRadius: 10, border: "1px solid #444", background: "transparent" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Kategori</span>
              <input
                name="category"
                defaultValue={category}
                placeholder="familj"
                style={{ padding: 10, borderRadius: 10, border: "1px solid #444", background: "transparent" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Nästa dagar</span>
              <input
                name="days"
                defaultValue={daysRaw}
                placeholder="7"
                inputMode="numeric"
                style={{ padding: 10, borderRadius: 10, border: "1px solid #444", background: "transparent" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.8, marginRight: 6 }}>Pris:</span>
            <a href={hrefAll} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #444", textDecoration: "none" }}>
              Alla
            </a>
            <a href={hrefFree} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #444", textDecoration: "none" }}>
              Gratis
            </a>
            <a href={hrefPaid} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #444", textDecoration: "none" }}>
              Betalt
            </a>

            <button type="submit" style={{ marginLeft: "auto", padding: "8px 12px", borderRadius: 10, border: "1px solid #444", background: "transparent" }}>
              Uppdatera filter
            </button>
          </div>

          {price ? <input type="hidden" name="price" value={price} /> : null}
        </form>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Aktivt: {city ? `stad=${city} ` : ""}{category ? `kategori=${category} ` : ""}{price ? `pris=${price} ` : ""}{daysRaw ? `days=${daysRaw}` : ""}
          {!city && !category && !price && !daysRaw ? "inga filter" : ""}
        </div>
      </section>

      {events.length === 0 ? (
        <p>Inga kommande events hittades för valda filter.</p>
      ) : (
        <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
          {events.map((e) => (
            <li key={e.id} style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 700 }}>{e.title || "Untitled event"}</div>
              <div style={{ opacity: 0.85 }}>
                {new Date(e.start_at).toLocaleString("sv-SE")} · {e.city || "—"} · {e.venue_name || "—"}
              </div>
              <div style={{ marginTop: 6, opacity: 0.9 }}>
                Pris: {formatPrice(e)}{e.category ? ` · ${e.category}` : ""}
              </div>
              <div style={{ marginTop: 6 }}>
                {e.ticket_url ? <a href={e.ticket_url}>Biljetter</a> : null}
                {e.ticket_url && e.source_url ? " · " : null}
                {e.source_url ? <a href={e.source_url}>Källa</a> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

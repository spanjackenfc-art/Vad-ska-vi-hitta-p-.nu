import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !service) {
  console.error("Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, service, { auth: { persistSession: false } });

async function headCount(table, filters = (q)=>q) {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  q = filters(q);
  const { count, error } = await q;
  if (error) {
    console.error("COUNT FAIL", table, JSON.stringify(error, null, 2));
    throw new Error(`${table}: ${error.message || "unknown error"}`);
  }
  return count ?? 0;
}

async function sampleViewMissing(limit = 10) {
  // View har ofta INTE samma kolumner som events.
  const { data, error } = await supabase
    .from("public_events_with_cta")
    .select("id,title,city,source_id,source_url,image_url,start_at")
    .is("image_url", null)
    .not("source_url", "is", null)
    .order("start_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("VIEW SAMPLE FAIL", JSON.stringify(error, null, 2));
    throw new Error(`public_events_with_cta sample: ${error.message || "unknown error"}`);
  }
  return data || [];
}

async function sampleEventsMissing(limit = 10) {
  // events-tabellen bör ha fler fält
  const { data, error } = await supabase
    .from("events")
    .select("id,title,city,source_id,source_url,image_url,image_storage_path,image_url_original,image_cached_at,start_at")
    .is("image_url", null)
    .not("source_url", "is", null)
    .order("start_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("EVENTS SAMPLE FAIL", JSON.stringify(error, null, 2));
    throw new Error(`events sample: ${error.message || "unknown error"}`);
  }
  return data || [];
}

(async () => {
  const view = "public_events_with_cta";
  const base = "events";

  const viewAll = await headCount(view);
  const viewMissing = await headCount(view, q => q.is("image_url", null));

  const eventsAll = await headCount(base);
  const eventsMissing = await headCount(base, q => q.is("image_url", null));
  const eventsMissingHasStorage = await headCount(base, q =>
    q.is("image_url", null).not("image_storage_path", "is", null)
  );
  const eventsMissingHasOriginal = await headCount(base, q =>
    q.is("image_url", null).not("image_url_original", "is", null)
  );

  console.log("== IMG AUDIT ==");
  console.log("[view] total:", viewAll);
  console.log("[view] image_url NULL:", viewMissing);
  console.log("----");
  console.log("[events] total:", eventsAll);
  console.log("[events] image_url NULL:", eventsMissing);
  console.log("[events] image_url NULL but has image_storage_path:", eventsMissingHasStorage);
  console.log("[events] image_url NULL but has image_url_original:", eventsMissingHasOriginal);
  console.log("----");

  const sView = await sampleViewMissing(10);
  console.log("== SAMPLE (view missing image_url) ==");
  for (const r of sView) {
    console.log({
      id: r.id,
      title: (r.title || "").slice(0, 60),
      city: r.city,
      source_id: r.source_id,
      start_at: r.start_at,
      source_url: (r.source_url || "").slice(0, 140),
    });
  }

  console.log("----");
  const sEv = await sampleEventsMissing(10);
  console.log("== SAMPLE (events missing image_url) ==");
  for (const r of sEv) {
    console.log({
      id: r.id,
      title: (r.title || "").slice(0, 60),
      source_id: r.source_id,
      start_at: r.start_at,
      source_url: (r.source_url || "").slice(0, 140),
      image_storage_path: r.image_storage_path,
      image_url_original: r.image_url_original,
      image_cached_at: r.image_cached_at,
    });
  }
})().catch((e) => {
  console.error("AUDIT FAILED:", e?.message || e);
  process.exit(1);
});

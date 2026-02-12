import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!service) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, service, { auth: { persistSession: false } });

// From your audit:
const EVENT_ID = "7c7cdda2-dce6-4817-9c99-60f050094397";

const { data: ev, error: evErr } = await supabase
  .from("public_events_with_cta")
  .select("id,title,ticket_url,source_url,image_url")
  .eq("id", EVENT_ID)
  .limit(1)
  .maybeSingle();

if (evErr) throw evErr;
if (!ev) throw new Error("Event not found for EVENT_ID: " + EVENT_ID);

const now = new Date();
const starts_at = new Date(now.getTime() - 5 * 60 * 1000).toISOString();      // active from 5 min ago
const ends_at   = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // active 30 days

const row = {
  package: "P4",
  placement: "hero_banner",
  event_id: ev.id,
  title: `Sponsrat: ${String(ev.title || "Arne Alligator")}`,
  image_url: null, // let UI fall back to event image
  cta_url: String(ev.ticket_url || ev.source_url || "#"),
  starts_at,
  ends_at,
  geo: "hela_sverige",
  category: null,
  priority: 1,
  is_active: true,
};

const { data: ins, error: insErr } = await supabase
  .from("sponsorships")
  .insert(row)
  .select("id,package,placement,event_id,priority,starts_at,ends_at,is_active")
  .single();

if (insErr) throw insErr;

console.log("✅ inserted sponsorship:", ins);

// Verify it will be picked up by page.tsx query (active, hero_banner, within window)
const nowIso = new Date().toISOString();
const { data: active, error: aErr } = await supabase
  .from("sponsorships")
  .select("id,package,placement,event_id,priority,starts_at,ends_at,is_active")
  .eq("is_active", true)
  .eq("placement", "hero_banner")
  .lte("starts_at", nowIso)
  .gte("ends_at", nowIso)
  .order("priority", { ascending: true })
  .limit(5);

if (aErr) throw aErr;

console.log("== active hero_banner now ==");
console.log(active);

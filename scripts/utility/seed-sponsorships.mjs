import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!service) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, service, { auth: { persistSession: false } });

const now = new Date();
const starts_at = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago
const ends_at = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(); // +14 days

async function pickEventId() {
  const { data, error } = await supabase
    .from("public_events_with_cta")
    .select("id,title,start_at,city")
    .gte("start_at", now.toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!data?.[0]) throw new Error("No upcoming events found in public_events_with_cta");

  console.log("Picked event:", data[0]);
  return data[0].id;
}

async function insertSpons(rows) {
  // OBS: vi sätter INTE id (bigint identity i DB)
  const { data, error } = await supabase
    .from("sponsorships")
    .insert(rows)
    .select("id,placement,package,event_id,is_active,starts_at,ends_at,priority");

  if (error) throw error;
  console.log("Inserted:", data);
}

async function main() {
  const event_id = await pickEventId();

  // Matchar app/page.tsx:
  // - hero_banner hämtas med .limit(2) och används som hero + infeed
  // - listing_top hämtas med .limit(3)
  const rows = [
    {
      placement: "hero_banner",
      package: "P3",
      event_id,
      title: "Sponsrat (TEST) – Hero",
      image_url: null,
      cta_url: null,
      starts_at,
      ends_at,
      priority: 1,
      is_active: true,
    },
    {
      placement: "hero_banner",
      package: "P4",
      event_id,
      title: "Sponsrat (TEST) – Infeed",
      image_url: null,
      cta_url: null,
      starts_at,
      ends_at,
      priority: 2,
      is_active: true,
    },
    {
      placement: "listing_top",
      package: "P2",
      event_id,
      title: "Sponsrat (TEST) – Topplista 1",
      image_url: null,
      cta_url: null,
      starts_at,
      ends_at,
      priority: 1,
      is_active: true,
    },
    {
      placement: "listing_top",
      package: "P2",
      event_id,
      title: "Sponsrat (TEST) – Topplista 2",
      image_url: null,
      cta_url: null,
      starts_at,
      ends_at,
      priority: 2,
      is_active: true,
    },
    {
      placement: "listing_top",
      package: "P2",
      event_id,
      title: "Sponsrat (TEST) – Topplista 3",
      image_url: null,
      cta_url: null,
      starts_at,
      ends_at,
      priority: 3,
      is_active: true,
    },
  ];

  await insertSpons(rows);
  console.log("✅ Done. Refresh UI: hero sponsorship + topplista should appear.");
}

main().catch((e) => {
  console.error("❌ seed failed:", e);
  process.exit(1);
});

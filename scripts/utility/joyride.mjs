import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("ENV:", { SUPABASE_URL: !!url, SUPABASE_SERVICE_ROLE_KEY: !!key });

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const q = "joyride";
const nowISO = new Date().toISOString();

const { data, error } = await supabase
  .from("public_events_with_cta")
  .select("id,title,start_at,city,ticket_url,source_url")
  .ilike("title", `%${q}%`)
  .gte("start_at", nowISO)
  .order("start_at", { ascending: true })
  .limit(20);

if (error) {
  console.error(error);
  process.exit(1);
}

console.log("== JOYRIDE matches ==");
console.log(
  (data || []).map(x => ({
    id: x.id,
    title: x.title,
    start_at: x.start_at,
    city: x.city,
    url: x.ticket_url || x.source_url
  }))
);

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!service) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, service, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from("sponsorships")
  .select("*")
  .order("id", { ascending: false })
  .limit(1);

if (error) throw error;

const row = data?.[0];
console.log("== sponsorships latest row ==");
console.log(row);

console.log("== sponsorships columns (keys) ==");
console.log(Object.keys(row || {}).join(", "));

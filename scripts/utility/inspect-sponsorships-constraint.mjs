import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!service) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const sql = `
    select
      con.conname as name,
      pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'sponsorships'
      and con.conname = 'sponsorships_package_check'
    limit 1;
  `;

  const { data, error } = await supabase.rpc("exec_sql", { sql });

  // Om du inte har RPC-funktionen exec_sql, fall tillbaka till error med instruktion
  if (error) {
    console.error("RPC exec_sql failed:", error);
    console.error("You likely don't have public.exec_sql RPC. We'll use a different method next step.");
    process.exit(1);
  }

  console.log("== sponsorships_package_check ==");
  console.log(data?.[0] || data);
}

main().catch((e) => {
  console.error("❌ inspect failed:", e);
  process.exit(1);
});

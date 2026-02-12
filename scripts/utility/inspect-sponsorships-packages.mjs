import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!service) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const { data, error, count } = await supabase
    .from("sponsorships")
    .select("id, package, placement, is_active, starts_at, ends_at, priority", { count: "exact" })
    .limit(1000);

  if (error) {
    console.error("❌ query failed:", error);
    process.exit(1);
  }

  console.log("== sponsorships count ==");
  console.log(count ?? (data?.length ?? 0));

  const rows = data || [];
  const packages = Array.from(new Set(rows.map(r => String(r.package)).filter(Boolean))).sort();
  const placements = Array.from(new Set(rows.map(r => String(r.placement)).filter(Boolean))).sort();

  console.log("== distinct package (existing, therefore allowed) ==");
  console.log(packages.join(", ") || "(none)");

  console.log("== distinct placement (existing) ==");
  console.log(placements.join(", ") || "(none)");

  const active = rows.filter(r => r.is_active);
  console.log("== active rows (sample up to 20) ==");
  for (const r of active.slice(0, 20)) {
    console.log({
      id: r.id,
      package: r.package,
      placement: r.placement,
      priority: r.priority,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
    });
  }
}

main().catch((e) => {
  console.error("❌ inspect failed:", e);
  process.exit(1);
});

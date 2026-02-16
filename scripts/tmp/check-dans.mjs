import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error("Missing env: need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and a key (SERVICE_ROLE or ANON).")
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const now = new Date()
const TZ = "Europe/Stockholm"
const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
const parts = fmt.formatToParts(now)
const y = Number(parts.find(p => p.type === "year")?.value)
const m = Number(parts.find(p => p.type === "month")?.value)
const d = Number(parts.find(p => p.type === "day")?.value)
const nowISO = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString()

const run = async () => {
  const base = supabase
    .from("public_events_with_cta")
    .select("id,title,category,start_at,venue_name,city", { count: "exact" })
    .gte("start_at", nowISO)
    .eq("category", "dans")
    .order("start_at", { ascending: true })
    .limit(20)

  const { data, count, error } = await base
  if (error) {
    console.error("Query error:", error)
    process.exit(2)
  }

  console.log("nowISO:", nowISO)
  console.log("count:", count ?? 0)
  for (const r of (data || [])) {
    console.log(`${r.start_at} | ${JSON.stringify(r.category)} | ${r.city} | ${r.venue_name} | ${r.title} | ${r.id}`)
  }

  const { data: distinct, error: e2 } = await supabase
    .from("public_events_with_cta")
    .select("category")
    .gte("start_at", nowISO)
    .ilike("venue_name", "%göteborgsoperan%")
    .limit(200)

  if (e2) {
    console.error("Distinct fetch error:", e2)
    process.exit(3)
  }

  const uniq = Array.from(new Set((distinct || []).map(x => JSON.stringify((x.category ?? null)))))
  uniq.sort()
  console.log("göteborgsoperan.categories:", uniq.join(", "))
}

run().catch((e) => {
  console.error(e)
  process.exit(9)
})

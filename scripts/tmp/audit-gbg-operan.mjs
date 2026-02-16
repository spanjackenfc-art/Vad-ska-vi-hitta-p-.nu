import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) { console.error("Missing SUPABASE url/key in env"); process.exit(1) }

const supabase = createClient(url, key, { auth: { persistSession: false } })

const TZ = "Europe/Stockholm"
const now = new Date()
const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
const parts = fmt.formatToParts(now)
const y = Number(parts.find(p => p.type === "year")?.value)
const m = Number(parts.find(p => p.type === "month")?.value)
const d = Number(parts.find(p => p.type === "day")?.value)
const nowISO = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString()

const run = async () => {
  const { data, error } = await supabase
    .from("public_events_with_cta")
    .select("id,title,category,subcategory,audience,start_at,city,venue_name,source_url")
    .gte("start_at", nowISO)
    .ilike("venue_name", "%göteborgsoperan%")
    .order("start_at", { ascending: true })
    .limit(400)

  if (error) { console.error(error); process.exit(2) }

  console.log("nowISO:", nowISO)
  console.log("rows:", data?.length || 0)

  const rows = data || []
  const counts = new Map()
  for (const r of rows) {
    const k = (r.category ?? "NULL").toLowerCase()
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  console.log("countsByCategory:", Object.fromEntries([...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0]))))

  for (const r of rows) {
    console.log(`${r.start_at} | cat=${JSON.stringify(r.category)} sub=${JSON.stringify(r.subcategory)} aud=${JSON.stringify(r.audience)} | ${r.title} | ${r.id}`)
  }
}

run().catch((e)=>{ console.error(e); process.exit(9) })

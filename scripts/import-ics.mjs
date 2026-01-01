import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import ical from "ical";
import { createClient } from "@supabase/supabase-js";

const ICS_URL =
  "https://calendar.google.com/calendar/ical/c_6c519bec78f6c01907e078c0fbe164e11092e703fdcaa5dd50c03704c2c56bef%40group.calendar.google.com/public/basic.ics";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function clean(x) {
  if (!x) return null;
  return String(x).trim().replace(/\s+/g, " ");
}

async function run() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();

  const parsed = ical.parseICS(text);
  let count = 0;

  for (const k of Object.keys(parsed)) {
    const ev = parsed[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (!ev.start) continue;

    const fingerprint = `${ev.uid || k}__${new Date(ev.start).toISOString()}`;

    const payload = {
      fingerprint,
      title: clean(ev.summary) || "Untitled event",
      description: clean(ev.description),
      start_at: new Date(ev.start).toISOString(),
      end_at: ev.end ? new Date(ev.end).toISOString() : null,
      venue_name: clean(ev.location),
      city: null,
      price_type: "unknown",
      source_url: ICS_URL,
      status: "active",
    };

    const { error } = await supabase
      .from("events")
      .upsert(payload, { onConflict: "fingerprint" });

    if (!error) count += 1;
  }

  console.log(`Klart. Upsertade ${count} events.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

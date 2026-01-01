import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import ical from "ical";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function clean(x) {
  if (!x) return null;
  return String(x).trim().replace(/\s+/g, " ");
}

function parsePrice(priceTextRaw) {
  const t = (priceTextRaw || "").toLowerCase();
  if (!t) return { price_type: "unknown", price_min: null, price_max: null };
  if (t.includes("gratis")) return { price_type: "free", price_min: 0, price_max: 0 };

  const nums = (priceTextRaw.match(/\d+/g) || []).map((n) => Number(n));
  if (nums.length === 1) return { price_type: "paid", price_min: nums[0], price_max: nums[0] };
  if (nums.length >= 2) return { price_type: "paid", price_min: Math.min(...nums), price_max: Math.max(...nums) };

  return { price_type: "unknown", price_min: null, price_max: null };
}

async function fetchSources() {
  const { data, error } = await supabase
    .from("sources")
    .select("id,name,url,city,category,parser,kind,is_active")
    .eq("is_active", true);

  if (error) throw error;
  return data ?? [];
}

async function upsertEvent(payload) {
  const { error } = await supabase
    .from("events")
    .upsert(payload, { onConflict: "fingerprint" });

  if (error) throw error;
}

async function importICS(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`ICS fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const text = await res.text();

  const parsed = ical.parseICS(text);
  let count = 0;

  for (const k of Object.keys(parsed)) {
    const ev = parsed[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (!ev.start) continue;

    const startISO = new Date(ev.start).toISOString();
    const uid = ev.uid || k;

    const fingerprint = `${source.id}__${uid}__${startISO}`;

    const payload = {
      fingerprint,
      title: clean(ev.summary) || "Untitled event",
      description: clean(ev.description),
      category: source.category ?? null,
      start_at: startISO,
      end_at: ev.end ? new Date(ev.end).toISOString() : null,
      city: source.city ?? null,
      venue_name: clean(ev.location),
      price_type: "unknown",
      source_url: source.url,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}

function extractField(block, label) {
  const idx = block.indexOf(label);
  if (idx === -1) return null;
  return clean(block.slice(idx + label.length));
}

async function importKulturStockholm(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cards = [];

  $("h4").each((_, h4) => {
    const a = $(h4).find("a").first();
    const title = clean(a.text());
    if (!title) return;

    const href = a.attr("href") || null;

    let cursor = $(h4).next();
    let blob = "";

    while (cursor.length && cursor[0].tagName !== "h4") {
      const t = clean(cursor.text());
      if (t) blob += (blob ? "\n" : "") + t;
      cursor = cursor.next();
    }

    const datum = extractField(blob, "Datum:");
    const tid = extractField(blob, "Tid:");
    const plats = extractField(blob, "Plats:");
    const pris = extractField(blob, "Pris:");

    cards.push({ title, href, datum, tid, plats, pris });
  });

  const seen = new Set();
  const unique = [];
  for (const c of cards) {
    const key = `${c.title}__${c.datum || ""}__${c.plats || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  let count = 0;

  for (const c of unique) {
    const price = parsePrice(c.pris);

    const fingerprint = `${source.id}__${c.title}__${c.datum || ""}__${c.plats || ""}`;

    // MVP: temporär start_at (vi fixar riktig datumtolkning i nästa iteration)
    const startISO = new Date().toISOString();

    const payload = {
      fingerprint,
      title: c.title,
      description: [c.datum && `Datum: ${c.datum}`, c.tid && `Tid: ${c.tid}`, c.plats && `Plats: ${c.plats}`, c.pris && `Pris: ${c.pris}`]
        .filter(Boolean)
        .join("\n"),
      category: source.category ?? null,
      start_at: startISO,
      end_at: null,
      city: source.city ?? null,
      venue_name: c.plats ? clean(c.plats) : null,
      price_type: price.price_type,
      price_min: price.price_min,
      price_max: price.price_max,
      ticket_url: c.href,
      source_url: source.url,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}

async function run() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");

  const sources = await fetchSources();
  if (sources.length === 0) {
    console.log("Inga aktiva källor i 'sources'.");
    return;
  }

  let total = 0;

  for (const s of sources) {
  const t0 = Date.now();
    const parser = (s.parser || s.kind || "ics").toLowerCase();

    if (parser === "ics") {
      try {
      const n = await importICS(s);
      const ms = Date.now() - t0;
      console.log(`✅ [ICS] ${s.name}: ${n} (${ms} ms)`);
      total += n;
    } catch (e) {
      const ms = Date.now() - t0;
      console.log(`❌ [ICS] ${s.name}: ${e.message} (${ms} ms)`);
    }
    continue;
}

    if (parser === "html") {
      if (String(s.url).includes("kultur.stockholm/kalendarium")) {
        try {
        const n = await importKulturStockholm(s);
        const ms = Date.now() - t0;
        console.log(`✅ [HTML] ${s.name}: ${n} (${ms} ms)`);
        total += n;
      } catch (e) {
        const ms = Date.now() - t0;
        console.log(`❌ [HTML] ${s.name}: ${e.message} (${ms} ms)`);
      }
} else {
        console.log(`⚠️ [HTML] ${s.name}: ingen parser implementerad ännu (${s.url})`);
      }
      continue;
    }

    console.log(`⚠️ ${s.name}: okänd parser "${parser}"`);
  }

  console.log(`Klart. Totalt upsertade ${total} events.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

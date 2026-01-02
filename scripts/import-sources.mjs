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

function normalizeVenue(value) {
  const v = clean(value);
  if (!v) return null;

  // Matcha lat,lng eller "lat lng" med decimaltal
  const coordLike = /^\s*-?\d{1,2}\.\d+\s*[, ]\s*-?\d{1,3}\.\d+\s*$/;
  if (coordLike.test(v)) return null;

  // Om texten är "för numerisk" (ex: bara siffror/kommatecken/punkt)
  const onlyNumPunct = /^[\d\s,.\-]+$/.test(v);
  if (onlyNumPunct && v.replace(/[\s,.\-]/g, "").length >= 6) return null;

  return v;
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

async function logIngestionRun({ source, parser, startedAtISO, finishedAtISO, durationMs, upsertedCount, success, errorMessage }) {
  // 1) Append-only logg
  const { error } = await supabase.from("ingestion_runs").insert({
    source_id: source.id,
    source_name: source.name,
    parser,
    started_at: startedAtISO,
    finished_at: finishedAtISO,
    duration_ms: durationMs,
    upserted_count: upsertedCount,
    success,
    error_message: errorMessage || null,
  });
  if (error) throw error;
}

async function updateSourceHealth({ source, finishedAtISO, durationMs, upsertedCount, success, errorMessage }) {
  // 2) Senaste status på källan
  const patch = {
    last_run_at: finishedAtISO,
    last_duration_ms: durationMs,
    last_upserted_count: upsertedCount,
    last_error: success ? null : (errorMessage || "Unknown error"),
    last_success_at: success ? finishedAtISO : undefined,
  };

  // Supabase skickar inte undefined -> bra, då uppdateras last_success_at bara vid success
  const { error } = await supabase
    .from("sources")
    .update(patch)
    .eq("id", source.id);

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
      venue_name: normalizeVenue(ev.location),
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
      venue_name: normalizeVenue(c.plats),
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


function parseVisitDateRange(raw) {
  const t = clean(raw);
  if (!t) return { startISO: null, endISO: null };

  const months = {
    jan: 0, januari: 0,
    feb: 1, februari: 1,
    mar: 2, mars: 2,
    apr: 3, april: 3,
    maj: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    aug: 7, augusti: 7,
    sep: 8, september: 8,
    okt: 9, oktober: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  function parseOne(s) {
    const m = String(s).trim().match(/^([A-Za-zÅÄÖåäö]{3,9})\s+(\d{1,2})$/);
    if (!m) return null;
    const mon = months[m[1].toLowerCase()];
    if (mon === undefined) return null;
    const day = Number(m[2]);
    return { mon, day };
  }

  const parts = t.split("-").map((x) => x.trim());
  const a = parseOne(parts[0]);
  const b = parts[1] ? parseOne(parts[1]) : null;
  if (!a) return { startISO: null, endISO: null };

  // Year-inferens: om datumet ligger "bakåt" långt i tiden, anta nästa år
  const now = new Date();
  let yearA = now.getUTCFullYear();
  const approxA = new Date(Date.UTC(yearA, a.mon, a.day, 12, 0, 0));
  if (approxA.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 180) yearA += 1;

  const start = new Date(Date.UTC(yearA, a.mon, a.day, 12, 0, 0));

  let end = null;
  if (b) {
    let yearB = yearA;
    const approxB = new Date(Date.UTC(yearB, b.mon, b.day, 12, 0, 0));
    if (approxB.getTime() < start.getTime()) yearB += 1;
    end = new Date(Date.UTC(yearB, b.mon, b.day, 12, 0, 0));
  }

  return { startISO: start.toISOString(), endISO: end ? end.toISOString() : null };
}

async function importVisitStockholm(source) {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": "SverigeEventBot/0.1 (+local dev)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const nextDataText = $("script#__NEXT_DATA__").text();
  if (!nextDataText) return 0;

  let nextData;
  try {
    nextData = JSON.parse(nextDataText);
  } catch (e) {
    throw new Error("Visit: kunde inte JSON-parsa __NEXT_DATA__");
  }

  const blocks = nextData?.props?.pageProps?.componentProps?.contentBlocks || [];
  const rawItems = [];

  for (const b of blocks) {
    const items = b?.value?.items;
    if (Array.isArray(items)) {
      for (const it of items) rawItems.push(it);
    }
  }

  // Filtrera till objekt som ser ut som event
  const candidates = rawItems.filter((it) =>
    it &&
    typeof it === "object" &&
    typeof it.title === "string" &&
    it.title.length >= 2 &&
    typeof it.startDate === "string" &&
    typeof it.href === "string"
  );

  // Dedup på href + startDate
  const seen = new Set();
  const unique = [];
  for (const it of candidates) {
    const key = `${it.href}__${it.startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  let count = 0;

  for (const it of unique) {
    const startISO = new Date(it.startDate).toISOString();
    const endISO = it.endDate ? new Date(it.endDate).toISOString() : null;

    // href kan vara intern eller extern
    const hrefAbs = it.href.startsWith("http")
      ? it.href
      : it.href.startsWith("/")
        ? `https://www.visitstockholm.se${it.href}`
        : `https://www.visitstockholm.se/${it.href}`;

    const ticket = it.externalWebsiteUrl && String(it.externalWebsiteUrl).startsWith("http")
      ? String(it.externalWebsiteUrl)
      : hrefAbs;

    const venue = it.venueName || it.address || (it.location && (it.location.name || it.location.title)) || null;

    const fingerprint = `${source.id}__${hrefAbs}__${startISO}`;

    const payload = {
      fingerprint,
      title: clean(it.title) || "Untitled event",
      description: clean(it.description),
      category: source.category ?? null,
      start_at: startISO,
      end_at: endISO,
      city: (it.city ? clean(it.city) : null) ?? (source.city ?? null),
      venue_name: normalizeVenue(venue),
      price_type: "unknown",
      ticket_url: ticket,
      source_url: hrefAbs,
      status: "active",
    };

    await upsertEvent(payload);
    count += 1;
  }

  return count;
}



function parseKonserthusetDateTime(raw) {
  // Ex: "Måndag 5 januari 2026 kl 17.00"
  const t = clean(raw);
  if (!t) return null;

  const months = {
    januari: 0, february: 1, februari: 1, mars: 2, april: 3, maj: 4, juni: 5, juli: 6,
    augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
  };

  const m = t.match(/(\d{1,2})\s+([A-Za-zÅÄÖåäö]+)\s+(\d{4})\s+kl\s+(\d{1,2})\.(\d{2})/i);
  if (!m) return null;

  const day = Number(m[1]);
  const monName = m[2].toLowerCase();
  const year = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);

  const mon = months[monName];
  if (mon === undefined) return null;

  // Lokal tid i Stockholm → lagra som UTC ISO med korrekt offset via Date()
  // Vi skapar först en datumsträng som JS tolkar som lokal tid.
  const local = new Date(year, mon, day, hh, mm, 0);
  return local.toISOString();
}

async function importKonserthuset(source) {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": "SverigeEventBot/0.1 (+local dev)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];

  $("h3").each((_, el) => {
    const title = clean($(el).text());
    if (!title) return;

    const parent = $(el).parent();
    const blockText = clean(parent.text()) || "";

    const dateMatch = blockText.match(/(Måndag|Tisdag|Onsdag|Torsdag|Fredag|Lördag|Söndag)\s+\d{1,2}\s+\w+\s+\d{4}\s+kl\s+\d{1,2}\.\d{2}/i);
    const dateLine = dateMatch ? dateMatch[0] : null;

    // href: ibland sitter den runt hela kortet, ibland nära titeln
    const a = $(el).closest("a").length ? $(el).closest("a") : parent.find("a").first();
    const href = a.attr("href") || null;

        if (!dateLine || !href) return;

    items.push({ title, dateLine, href });
  });

  // Dedup
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const key = `${it.href}__${it.dateLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  let count = 0;

  for (const it of unique) {
    const startISO = parseKonserthusetDateTime(it.dateLine);
    if (!startISO) continue;

    const hrefAbs = it.href.startsWith("http")
      ? it.href
      : it.href.startsWith("/")
        ? `https://www.konserthuset.se${it.href}`
        : `https://www.konserthuset.se/${it.href}`;

    const fingerprint = `${source.id}__${hrefAbs}__${startISO}`;

    const payload = {
      fingerprint,
      title: it.title,
      description: it.dateLine ? `Tid: ${it.dateLine}` : null,
      category: source.category ?? null,
      start_at: startISO,
      end_at: null,
      city: source.city ?? "Stockholm",
      venue_name: "Konserthuset Stockholm",
      price_type: "unknown",
      ticket_url: hrefAbs,
      source_url: hrefAbs,
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
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
          source: s,
          parser: "ics",
          startedAtISO: new Date(t0).toISOString(),
          finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
        });
        await updateSourceHealth({
          source: s,
          finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
        });
} catch (e) {
      const ms = Date.now() - t0;
      console.log(`❌ [ICS] ${s.name}: ${e.message} (${ms} ms)`);
    
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
          source: s,
          parser: "ics",
          startedAtISO: new Date(t0).toISOString(),
          finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
        });
        await updateSourceHealth({
          source: s,
          finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
        });
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
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
          source: s,
          parser: "html",
          startedAtISO: new Date(t0).toISOString(),
          finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
        });
        await updateSourceHealth({
          source: s,
          finishedAtISO,
          durationMs: ms,
          upsertedCount: n,
          success: true,
          errorMessage: null,
        });
} catch (e) {
        const ms = Date.now() - t0;
        console.log(`❌ [HTML] ${s.name}: ${e.message} (${ms} ms)`);
      
        const finishedAtISO = new Date().toISOString();
        await logIngestionRun({
          source: s,
          parser: "html",
          startedAtISO: new Date(t0).toISOString(),
          finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
        });
        await updateSourceHealth({
          source: s,
          finishedAtISO,
          durationMs: ms,
          upsertedCount: 0,
          success: false,
          errorMessage: e.message,
        });
}
} else {
        if (String(s.url).includes("konserthuset.se/program-och-biljetter/kalender")) {
        const n = await importKonserthuset(s);
        const ms = Date.now() - t0;
        console.log(`✅ [HTML] ${s.name}: ${n} (${ms} ms)`);
        total += n;
      } else if (String(s.url).includes("visitstockholm.se/event")) {
        const n = await importVisitStockholm(s);
        const ms = Date.now() - t0;
        console.log(`✅ [HTML] ${s.name}: ${n} (${ms} ms)`);
        total += n;
      } else {
        console.log(`⚠️ [HTML] ${s.name}: ingen parser implementerad ännu (${s.url})`);
      }
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

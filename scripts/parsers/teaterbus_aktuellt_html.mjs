import * as cheerio from "cheerio";

/**
 * Teaterbus /aktuellt: extrahera spel-/speltider ur fri text.
 * Minimal v1: parse "Play Hamlet- Offelias Kalas" familj-datum (Januari/Februari) + "Alla dagar kl 15".
 */

const MONTHS = {
  januari: 0,
  februari: 1,
  mars: 2,
  april: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  augusti: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

function clean(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeLocalISO({ year, month, day, hh, mm }) {
  // Stockholm lokal tid -> Date(year, monthIndex, day, hh, mm)
  const d = new Date(year, month, day, hh, mm, 0);
  return d.toISOString();
}

function parseDaysList(s) {
  // Ex: "18, 24 och 31" -> [18,24,31]
  const t = clean(s).toLowerCase().replace(/och/g, ",");
  const nums = t.match(/\d{1,2}/g) || [];
  return [...new Set(nums.map(Number).filter(n => n >= 1 && n <= 31))];
}

export function parseTeaterbusAktuellt(html, source) {
  const $ = cheerio.load(html);
  const text = clean($("body").text());

  // Hitta p-block med pre-wrap som innehåller SPELTIDER familj (det är där datum/tider ligger)
  let slice = null;
  $("p[style*='white-space:pre-wrap']").each((_, el) => {
    const t = $(el).text() || "";
    if (/SPELTIDER\s+familj/i.test(t)) {
      slice = t;
      return false;
    }
  });

  if (!slice) return [];

  // plocka ut Januari- och Februari-rader i "SPELTIDER familj"
  // Ex i texten: "Januari 18, 24 och 31" / "Februari 1, 7 , 8 och 15"
  const janMatch = slice.match(/Januari\s+([0-9,\s]+(?:och\s+[0-9]{1,2})?)/i);
  const febMatch = slice.match(/Februari\s+([0-9,\s]+(?:och\s+[0-9]{1,2})?)/i);

  // tid: "Alla dagar kl 15" (kan vara "kl 15" utan :00)
  const timeMatch = slice.match(/Alla dagar\s+kl\s+(\d{1,2})(?:[.:](\d{2}))?/i);
  const hh = timeMatch ? Number(timeMatch[1]) : 15;
  const mm = timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 0;

  const year = 2026; // v1: hårdkodat från sidan "vintern 2026"

  const daysJan = janMatch ? parseDaysList(janMatch[1]) : [];
  const daysFeb = febMatch ? parseDaysList(febMatch[1]) : [];

  const items = [];
  for (const d of daysJan) {
    items.push({ year, month: MONTHS.januari, day: d, hh, mm });
  }
  for (const d of daysFeb) {
    items.push({ year, month: MONTHS.februari, day: d, hh, mm });
  }

  // Placeholder: Skogsnästeatern (M/S Cirrus och havets sång) – maj 2026 kl 13 (datum ej specificerat på sidan)
  {
    const ps = $("p[style*='white-space:pre-wrap']").toArray().map(el => ($(el).text() || "").trim());
    const blob = ps.join("\n").toLowerCase();
    if (blob.includes("skogsnästeatern") && (blob.includes("maj 2026") || blob.includes("maj 22026"))) {
      items.push({ year: 2026, month: MONTHS.maj, day: 1, hh: 13, mm: 0, skogsnaste: true });
    }
  }

  // Förskola/skola: "Vardagar Tisd-Torsd from 20 jan." + "Tid: kl 11 och 13"
  // Vi genererar en rullande horisont på 30 dagar framåt för att undvika oändlig volym.
  const skolMatch = slice.match(/Tisd\s*[-–]\s*Torsd\s*from\s*(\d{1,2})\s*jan/i);
  const skolTimes = [11, 13];

  if (skolMatch) {
    const fromDay = Number(skolMatch[1]);
    const fromDate = new Date(2026, MONTHS.januari, fromDay, 0, 0, 0);

    const today = new Date();
    const start = today > fromDate ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : fromDate;
    const end = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 30);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay(); // 0=sön 1=mån 2=tis 3=ons 4=tor ...
      if (dow !== 2 && dow !== 3 && dow !== 4) continue;

      for (const h of skolTimes) {
        items.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hh: h, mm: 0, skol: true });
      }
    }
  }

  const titleFamilj = "Play Hamlet – Offelias Kalas";
  const titleSkola = "Play Hamlet – Offelias Kalas (skola/förskola)";
  const titleSkog = "M/S Cirrus och havets sång – Skogsnästeatern (datum ej specificerat)";
  const sourceUrl = source.url;

  return items.map(({ year, month, day, hh, mm, skol, skogsnaste }) => {
    const startISO = makeLocalISO({ year, month, day, hh, mm });
    const title = skogsnaste ? titleSkog : (skol ? titleSkola : titleFamilj);
    const fingerprint = `${source.id}__${title}__${startISO}__teaterbus_aktuellt`;
    return {
      fingerprint,
      source_id: String(source.id),
      title,
      description: skogsnaste
        ? "OBS: På Teater BUS /aktuellt anges endast månad (maj 2026) och tid kl 13. Datum är ej specificerat. Boka via boka@underjordiska.com. (Källa: Teater BUS /aktuellt)"
        : (skol
          ? "Skol-/förskoleföreställning. Tis–tors. (Källa: Teater BUS /aktuellt)"
          : "Speltid: 80 min. Familjeföreställning. (Källa: Teater BUS /aktuellt)"),
      category: source.category ?? null,
      start_at: startISO,
      end_at: null,
      city: source.city ?? "Stockholm",
      venue_name: "Teater BUS",
      price_type: "unknown",
      ticket_url: null,
      organizer_url: source.organizer_url ?? "https://www.teaterbus.com/",
      source_url: sourceUrl,
      status: "active",
    };
  });
}

export async function importTeaterbusAktuellt(source) {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`HTML fetch failed (${source.name}): ${res.status} ${res.statusText}`);
  const html = await res.text();
  return parseTeaterbusAktuellt(html, source);
}

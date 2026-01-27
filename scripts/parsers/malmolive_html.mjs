const BASE = "https://malmolive.se";

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return BASE + href;
  return BASE + "/" + href;
}

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function monthToNumber(monRaw) {
  const m = (monRaw || "").toLowerCase().replace(/\.$/, "");
  const map = new Map([
    ["jan", 1], ["januari", 1],
    ["feb", 2], ["februari", 2],
    ["mar", 3], ["mars", 3],
    ["apr", 4], ["april", 4],
    ["maj", 5],
    ["jun", 6], ["juni", 6],
    ["jul", 7], ["juli", 7],
    ["aug", 8], ["augusti", 8],
    ["sep", 9], ["sept", 9], ["september", 9],
    ["okt", 10], ["oktober", 10],
    ["nov", 11], ["november", 11],
    ["dec", 12], ["december", 12],
    // engelska kortformer
    ["may", 5],
    ["oct", 10],
  ]);
  return map.get(m) || null;
}

function toIsoLocal({ year, month, day, hh, mm }) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}:00`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "SverigeEventBot/1.0 (+https://sverigeevent.se)",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.7",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function extractProgramLinks(html) {
  const re = /href="(\/program\/[^"#?]+)"/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== "/program") out.add(absUrl(m[1]));
  }
  return [...out];
}

function extractTitle(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? norm(m[1].replace(/<[^>]+>/g, " ")) : null;
}

function extractYearMapFromListing(listingHtml) {
  const map = new Map();
  const re = /href="(\/program\/[^"]+)"[\s\S]{0,500}?(\b20\d{2}\b)/gi;
  let m;
  while ((m = re.exec(listingHtml)) !== null) {
    map.set(absUrl(m[1]), Number(m[2]));
  }
  return map;
}

function extractTicketUrls(html) {
  const re = /href="(https:\/\/biljetter\.malmolive\.se\/events\/[^"]+)"/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return [...out];
}

function extractStartAts(html, year) {
  if (!year) return [];
  const out = [];
  const re = /<span[^>]*class="[^"]*event--date--detail[^"]*"[^>]*>([^<]+)<\/span>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const txt = norm(m[1]);
    const dm = txt.match(/(\d{1,2})\s+([A-Za-zÅÄÖåäö\.]+)\s+(\d{2}):(\d{2})/);
    if (!dm) continue;
    const day = Number(dm[1]);
    const mon = monthToNumber(dm[2]);
    const hh = Number(dm[3]);
    const mm = Number(dm[4]);
    if (!mon) continue;
    out.push(toIsoLocal({ year, month: mon, day, hh, mm }));
  }
  return [...new Set(out)];
}

function extractOgImage(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  const raw = m ? norm(m[1]) : null;
  if (!raw) return null;

  // normalisera HTML-escapes och gör absolut vid behov
  const cleaned = raw.replaceAll("&amp;", "&");
  return absUrl(cleaned) || cleaned;
}

export default async function malmolive_html(source) {
  const listing_url = source?.listing_url || `${BASE}/program`;
  const city = source?.city || "Malmö";
  const metro_city = source?.metro_city || "Malmö";
  const category = source?.category || "musik";

  const listingHtml = await fetchText(listing_url);
  const links = extractProgramLinks(listingHtml);
  const yearMap = extractYearMapFromListing(listingHtml);

  const events = [];

  for (const url of links) {
    let html;
    try {
      html = await fetchText(url);
    } catch {
      continue;
    }

    const title = extractTitle(html);
    if (!title) continue;

    const ticketUrls = extractTicketUrls(html);
    if (!ticketUrls.length) continue;

    const year = yearMap.get(url);
    const startAts = extractStartAts(html, year);
    if (!startAts.length) continue;

    const image_url = extractOgImage(html);

    for (let i = 0; i < Math.min(ticketUrls.length, startAts.length); i++) {
      events.push({
        title,
        description: null,
        start_at: startAts[i],
        end_at: null,
        city,
        metro_city,
        venue_name: "Malmö Live Konserthus",
        category,
        price_type: "unknown",
        listing_url,
        source_url: url,
        organizer_url: url,
        ticket_url: ticketUrls[i],
        image_url: image_url || null,
      });
    }
  }

  return events;
}

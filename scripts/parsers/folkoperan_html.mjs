import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/\s+/g, " ");
  return s || null;
}

function toAbsUrl(pathOrUrl, base) {
  const v = String(pathOrUrl || "").trim();
  if (!v) return null;
  try { return new URL(v, base).toString(); } catch { return null; }
}

function monthNumSv(m) {
  const t = String(m || "").toLowerCase().trim();
  const map = {
    januari: 1, jan: 1,
    februari: 2, feb: 2,
    mars: 3, mar: 3,
    april: 4, apr: 4,
    maj: 5,
    juni: 6, jun: 6,
    juli: 7, jul: 7,
    augusti: 8, aug: 8,
    september: 9, sep: 9,
    oktober: 10, okt: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };
  return map[t] || null;
}

function parseStartAtSv(dateTextRaw, timeTextRaw) {
  const d = String(dateTextRaw || "").toLowerCase();
  const t = String(timeTextRaw || "").trim();

  // "lördag 31 januari 2026"
  const m = d.match(/\b(\d{1,2})\s+([a-zåäö]+)\s+(20\d{2})\b/i);
  if (!m) return null;

  const day = Number(m[1]);
  const mon = monthNumSv(m[2]);
  const year = Number(m[3]);
  if (!mon || !year || !day) return null;

  const tm = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  const hh = tm ? Number(tm[1]) : 0;
  const mm = tm ? Number(tm[2]) : 0;

  const dt = new Date(Date.UTC(year, mon - 1, day, hh, mm, 0));
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)" }
  });
  if (!res.ok) return "";
  return await res.text();
}

function extractShowUrlsFromHome(homeHtml) {
  const $ = cheerio.load(homeHtml);
  const urls = [];
  $('a[href*="/uppsattningar/"]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (!href) return;
    const abs = toAbsUrl(href, "https://folkoperan.se/");
    if (!abs) return;
    if (/^https:\/\/folkoperan\.se\/uppsattningar\/[^\/]+\/?$/i.test(abs)) {
      urls.push(abs.replace(/\/$/, "") + "/");
    }
  });
  const seen = new Set();
  return urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

function parseShowPage(html, showUrl, source) {
  const $ = cheerio.load(html);

  const pageTitle =
    clean($('meta[property="og:title"]').attr("content")) ||
    clean($("h1").first().text()) ||
    null;

  const image =

    clean($('meta[property="og:image"]').attr("content")) ||
    clean($('meta[name="twitter:image"]').attr("content")) ||
    null;

  const out = [];

  $(".c-event-list__item").each((_i, el) => {
    // Date
    const dateText =
      clean($(el).find("h4.c-heading.-eta").first().text()) ||
      clean($(el).find("h4").first().text()) ||
      null;

    // Time: first small-text in left column
    const timeText =
      clean($(el).find(".c-event-list__item__left span.u-small-text").first().text()) ||
      clean($(el).find("span.u-small-text").first().text()) ||
      null;

    const ticketHref =
      $(el).find('a[aria-label*="Köp"][href]').first().attr("href") ||
      $(el).find('a[href*="biljetter.folkoperan.se"]').first().attr("href") ||
      "";

    const ticketUrl = toAbsUrl(ticketHref, showUrl);
    const startIso = parseStartAtSv(dateText, timeText);

    const rowTitle =
      clean($(el).find("h3.c-heading").first().text()) ||
      clean($(el).find("h3").first().text()) ||
      pageTitle;

    if (!rowTitle || !startIso || !ticketUrl) return;

    out.push({
      title: rowTitle,
      description: null,
      start_at: startIso,
      end_at: null,
      city: clean(source?.city) || "Stockholm",
      venue_name: "Folkoperan",
      ticket_url: ticketUrl,
      organizer_url: showUrl,
      source_url: showUrl,
      listing_url: "https://folkoperan.se/",
      image_url: image ? (toAbsUrl(image, showUrl) || image) : null,
      category: clean(source?.category) || "teater",
      price_type: "unknown",
    });
  });

  return out;
}

export async function importFolkoperan(source) {
  const homeUrl = "https://folkoperan.se/";
  const homeHtml = await fetchHtml(homeUrl);
  if (!homeHtml) return [];

  const showUrls = extractShowUrlsFromHome(homeHtml);

  const out = [];
  for (const showUrl of showUrls.slice(0, 40)) {
    const html = await fetchHtml(showUrl);
    if (!html) continue;
    out.push(...parseShowPage(html, showUrl, source));
  }

  const seen = new Set();
  const deduped = [];
  for (const it of out) {
    const k = `${it.title}__${it.start_at}__${it.ticket_url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }

  return deduped;
}

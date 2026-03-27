import * as cheerio from "cheerio";
import htmlParser from "./html.mjs";

function clean(x) {
  if (!x) return null;
  return String(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeImageUrl(u) {
  const s = clean(u);
  if (!s) return null;
  if (s.startsWith("https://www.nortic.sehttps://")) {
    return s.replace(/^https:\/\/www\.nortic\.se/, "");
  }
  if (s.startsWith("http://www.nortic.sehttps://")) {
    return s.replace(/^http:\/\/www\.nortic\.se/, "");
  }
  return s;
}

export default async function parse({ html, source }) {
  try {
    const $ = cheerio.load(String(html || ""));
    const hrefs = [];
    $('a[href*="nortic.se/ticket/event/"]').each((_, el) => {
      const href = clean($(el).attr("href"));
      if (href) hrefs.push(href);
    });

    const seenUrls = new Set();
    const urls = hrefs.filter(u => {
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });

    const out = [];
    const seenRows = new Set();

    for (const eventUrl of urls) {
      try {
        const res = await fetch(eventUrl, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; SverigeEventBot/1.0)" }
        });
        if (!res.ok) continue;

        const detailHtml = await res.text();
        const rows = await htmlParser({
          html: detailHtml,
          source: {
            url: eventUrl,
            city: source?.city || "Stockholm",
            category: source?.category || "teater",
          }
        });

        for (const row of rows || []) {
          if (!row?.title || !row?.start_at) continue;

          const fixed = {
            ...row,
            city: row.city || source?.city || "Stockholm",
            venue_name: row.venue_name || "Ö2 Scenkonst",
            organizer_url: eventUrl,
            source_url: eventUrl,
            listing_url: source?.url || null,
            category: row.category || source?.category || "teater",
            image_url: normalizeImageUrl(row.image_url),
          };

          const k = `${fixed.source_url}__${fixed.start_at}__${fixed.title}`;
          if (seenRows.has(k)) continue;
          seenRows.add(k);
          out.push(fixed);
        }
      } catch {
        // ignore per-detail failure
      }
    }

    return out;
  } catch {
    return [];
  }
}

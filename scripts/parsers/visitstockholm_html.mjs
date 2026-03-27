import * as cheerio from "cheerio";

function clean(x) {
  if (!x) return null;
  return String(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(text) {
  const s = String(text || "").toLowerCase().trim();

  const months = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
    januari:0, februari:1, mars:2, april:3, maj:4, juni:5, juli:6,
    augusti:7, september:8, oktober:9, november:10, december:11
  };

  const m = s.match(/(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = months[m[2]];
  const yy = Number(m[3]);

  if (mm == null) return null;

  return new Date(Date.UTC(yy, mm, dd, 12, 0, 0)).toISOString();
}

async function fetchDetail(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const body = $("body").text().replace(/\s+/g, " ");

  const matches = body.match(/\b\d{1,2}\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+\d{4}\b/gi);

  let valid = null;

  if (matches) {
    valid = matches.find(x => {
      const year = Number((x.match(/\d{4}/) || [])[0]);
      return year >= 2024;
    });
  }

  if (valid) return parseDate(valid);

  return null;
}

export default async function parse({ html, source }) {
  try {
    const $ = cheerio.load(String(html || ""));
    const rows = [];
    const seen = new Set();

    const links = [];
    $('a[href*="/event/"]').each((_, el) => {
      const href = clean($(el).attr("href"));
      const title = clean($(el).text());
      if (!href || !title) return;
      if (!href.includes("/event/") || href.endsWith("/event/")) return;
      if (href.includes("/tipsa-om-evenemang/") || /posta tips|tipsa om ett event/i.test(title)) return;
      links.push({ href, title });
    });

    const uniq = [];
    const seenHref = new Set();
    for (const l of links) {
      if (seenHref.has(l.href)) continue;
      seenHref.add(l.href);
      uniq.push(l);
    }

    for (const it of uniq.slice(0, 30)) {
      let start_at = null;

      try {
        start_at = await fetchDetail(it.href);
      } catch {
        continue;
      }

      if (!start_at) continue;

      const key = `${it.href}__${start_at}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        title: it.title,
        start_at,
        city: source?.city || "Stockholm",
        venue_name: "Stockholm",
        description: null,
        image_url: null,
        ticket_url: it.href,
        organizer_url: it.href,
        source_url: it.href,
        listing_url: source?.url || null,
        category: source?.category || null,
        subcategory: null,
        price_type: "unknown",
      });
    }

    return rows;
  } catch {
    return [];
  }
}

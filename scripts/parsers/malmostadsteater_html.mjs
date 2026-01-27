const https = await import("node:https");

function httpGet(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request(
        {
          method: "GET",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers: {
            "user-agent": "Mozilla/5.0",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
        }
      );
      req.on("error", () => resolve({ status: 0, text: "" }));
      req.end();
    } catch {
      resolve({ status: 0, text: "" });
    }
  });
}

function stripTags(x) {
  return String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}



const __showCache = new Map();

function extractShowMeta(html) {
  const strip = (v) => stripTags(v || "");

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i);
  const tit = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  let title = strip(h1?.[1] || tit?.[1] || "") || null;

  // ---- robust meta image extraction (handles newlines, attribute order) ----
  let image_url = null;
  const metaTags = html.match(/<meta[^>]+>/gi) || [];

  for (const tag of metaTags) {
    const prop =
      tag.match(/property=["']([^"']+)["']/i)?.[1] ||
      tag.match(/name=["']([^"']+)["']/i)?.[1];

    if (!prop) continue;
    if (!/^(og:image|twitter:image)$/i.test(prop)) continue;

    const content = tag.match(/content=["\']([^"\']+)["\']/i)?.[1];
    if (content) {
      image_url = content.replaceAll("&amp;", "&").trim();
      break;
    }
  }

  const md = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const ogd = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const description = strip(md?.[1] || ogd?.[1] || "") || null;

  return { title, description, image_url };
}

async function getShowDetails(url) {
  const key = String(url || "").trim();
  if (!key) return { title: null, description: null, image_url: null };
  if (__showCache.has(key)) return __showCache.get(key);

  let out = { title: null, description: null, image_url: null };
  try {
    const res = await fetch(key, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
    });
    if (res.ok) {
      const html = await res.text();
      if (html) out = extractShowMeta(html);
    }
  } catch {}

  __showCache.set(key, out);
  return out;
}
function absUrl(base, href) {
  const h = String(href || "").trim();
  if (!h) return "";
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("//")) return "https:" + h;
  try { return new URL(h, base).toString(); } catch { return h; }
}

export default async function parse(source) {
  try {
    const s = source || {};
    const base = "https://www.malmostadsteater.se";
    const url = String(s.url || (base + "/kalender"));

    const res = await httpGet(url);
    if (res.status < 200 || res.status >= 300) return [];
    const h = res.text;

    const linkRe = /https:\/\/biljetter\.malmostadsteater\.se\/sv\/mst\/buyingflow\/tickets\/(\d+)\/(\d+)/g;

    const rows = [];
    let m;
    while ((m = linkRe.exec(h))) {
      const ticket_url = m[0];

      // Larger context chunk: date/time/title likely not within +-1200
      const start = Math.max(0, m.index - 6000);
      const end = Math.min(h.length, m.index + 6000);
      const chunk = h.slice(start, end);

      // 1) start_at from <time datetime="..."> if present
      let start_at = null;
      const tm = chunk.match(/datetime="(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+\-]\d{2}:\d{2})?)"/i);
      if (tm) {
        const d = new Date(tm[1].replace(" ", "T"));
        if (Number.isFinite(d.getTime())) start_at = d.toISOString();
      }

      // 2) title: prefer nearest h2/h3, else nearest internal link text (non-ticket)
      let title = null;
      const hm = chunk.match(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/i);
      if (hm) title = stripTags(hm[2]);

      if (!title) {
        // find first internal link to malmostadsteater that isn't mailto and not biljetter
        const am = chunk.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (am) {
          const href = String(am[1] || "");
          const t = stripTags(am[2] || "");
          if (t && !/köp biljetter/i.test(t)) title = t;
        }
      }

      // 3) event page (organizer_url): välj intern show-länk nära ticket-länken (smalt fönster)
      let organizer_url = null;

      // Smalare fönster runt biljettlänken för att undvika att fastna på random navigation-länkar
      const nearStart = Math.max(0, m.index - 1200);
      const nearEnd = Math.min(h.length, m.index + 1200);
      const near = h.slice(nearStart, nearEnd);

      const aRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let a;
      while ((a = aRe.exec(near))) {
        const href = String(a[1] || "").trim();
        if (!href) continue;
        if (/biljetter\.malmostadsteater\.se/i.test(href)) continue;
        if (href.startsWith("mailto:")) continue;

        const abs = absUrl(base, href);

        // Bara interna showsidor (inte kalender/startsida/policy)
        if (!abs.startsWith(base)) continue;
        const path = abs.slice(base.length).toLowerCase();
        if (path === "/" || path.startsWith("/kalender")) continue;
        if (path.includes("/personuppgift") || path.includes("/cookies")) continue;
        if (path.includes("/nyhetsbrev")) continue;

        organizer_url = abs;
        break;
      }
      // Fallback: om vi inte hittade organizer_url i "near" (±1200),
      // leta i den större chunken (±6000) för att hitta en intern showsida.
      if (!organizer_url) {
        let a2;
        aRe.lastIndex = 0;
        while ((a2 = aRe.exec(chunk))) {
          const href = String(a2[1] || "").trim();
          if (!href) continue;
          if (/biljetter\.malmostadsteater\.se/i.test(href)) continue;
          if (href.startsWith("mailto:")) continue;

          const abs = absUrl(base, href);
          if (!abs.startsWith(base)) continue;

          const path = abs.slice(base.length).toLowerCase();
          if (path === "/" || path.startsWith("/kalender")) continue;
          if (path.includes("/personuppgift") || path.includes("/cookies")) continue;
          if (path.includes("/nyhetsbrev")) continue;

          organizer_url = abs;
          break;
        }
      }

      if (!title || !start_at) continue;
      const source_url = organizer_url || s.url || null;

      const details = (organizer_url || source_url)
        ? await getShowDetails(organizer_url || source_url)
        : { title: null, description: null, image_url: null };

      const BLOCK_TITLE_RE = /(nyhetsbrev|anmäl dig|workshop|verkstad|klubb|reading|samtal|kalender)/i;
      const WEEKDAY_RE = /^(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/i;

      const pickTitle = (t) => {
        const x = String(t || "").trim();
        if (!x) return null;
        if (BLOCK_TITLE_RE.test(x)) return null;
        if (WEEKDAY_RE.test(x)) return null;
        return x;
      };

      const finalTitle = pickTitle(details.title) || pickTitle(title);
      if (!finalTitle) continue;

      const excerpt = stripTags(chunk).slice(0, 280) || null;
      const finalDesc = (details.description && String(details.description).trim()) ? details.description : excerpt;

      let finalImg = details.image_url || null;
      if (finalImg && typeof finalImg === "string" && finalImg.startsWith("/")) finalImg = base + finalImg;

      rows.push({
        title: finalTitle,
        start_at,
        city: s.city || "Malmö",
        venue_name: "Malmö Stadsteater",
        description: finalDesc,
        image_url: finalImg,
        ticket_url,
        organizer_url: organizer_url || null,
        source_url,
        listing_url: s.url || null,
        category: s.category || "teater",
        subcategory: null,
      });
}

    // de-dupe by ticket_url
    const seen = new Set();
    return rows.filter((r) => {
      if (seen.has(r.ticket_url)) return false;
      seen.add(r.ticket_url);
      return true;
    });
  } catch {
    return [];
  }
}

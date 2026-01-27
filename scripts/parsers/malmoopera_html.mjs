/**
 * Malmö Opera (Drupal 10) – ingestion contract:
 *   export default async function (source) => items[]
 *
 * We fetch:
 * - front HTML (to extract drupal-settings-json)
 * - Drupal Views AJAX (/views/ajax) to get calendar HTML fragment
 * Then parse instance blocks for date/time/title + official ticket URL.
 */
const https = await import("node:https");

const MONTHS_FULL = {
  januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
  juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
};
const MONTHS_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};

function stripTags(x) {
  return String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}



const __showCache = new Map();

function extractShowMeta(html) {
  const strip = (v) => stripTags(v || "");
  const ogt = html.match(/property="og:title"[^>]*content="([^"]+)"/i);
  const md  = html.match(/name="description"[^>]*content="([^"]+)"/i);
  const ogd = html.match(/property="og:description"[^>]*content="([^"]+)"/i);
  const ogi = html.match(/property="og:image"[^>]*content="([^"]+)"/i);

  // Malmö Opera har ofta "Carmen | Malmö Opera" i og:title; vi vill ha ren titel om möjligt.
  let title = strip(ogt?.[1] || "") || null;
  if (title && title.includes("|")) title = strip(title.split("|")[0]);

  const description = strip(md?.[1] || ogd?.[1] || "") || null;
  const image_url = ogi?.[1] ? String(ogi[1]).trim() : null;

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

function httpPostForm(url, data) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) params.set(k, String(v ?? ""));
      const body = params.toString();

      const req = https.request(
        {
          method: "POST",
          hostname: u.hostname,
          path: u.pathname + (u.search || ""),
          headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "content-length": Buffer.byteLength(body),
            "user-agent": "Mozilla/5.0",
            "accept": "application/json,text/javascript,*/*;q=0.1",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
        }
      );
      req.on("error", () => resolve({ status: 0, text: "" }));
      req.write(body);
      req.end();
    } catch {
      resolve({ status: 0, text: "" });
    }
  });
}

function extractDrupalSettings(frontHtml) {
  const m = String(frontHtml || "").match(/<script[^>]+data-drupal-selector="drupal-settings-json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function pickAjaxView(ds) {
  const ajaxPath = ds?.views?.ajax_path || "/views/ajax";
  const views = ds?.views?.ajaxViews || {};

  for (const v of Object.values(views)) {
    if (v?.view_name === "mo_instances" && v?.view_display_id === "calendar") {
      return { ajaxPath, v };
    }
  }
  const first = Object.values(views)[0];
  if (!first) return null;
  return { ajaxPath, v: first };
}

function extractHtmlFragmentsFromViewsAjax(jsonText) {
  let obj;
  try { obj = JSON.parse(jsonText); } catch { return ""; }

  const commands = Array.isArray(obj) ? obj : Object.values(obj);
  const parts = [];
  for (const c of commands) {
    const data = c?.data;
    if (typeof data === "string" && data.includes("<")) parts.push(data);
  }
  return parts.join("\n");
}

function parseStartAtFromTag(tagText, ctxYear) {
  // "ons 21 jan 19.00"
  const t = String(tagText || "").toLowerCase().trim();
  const m = t.match(/(\d{1,2})\s+([a-zåäö]{3})\s+(\d{1,2})\.(\d{2})/i);
  if (!m) return null;

  const dd = Number(m[1]);
  const mon = MONTHS_ABBR[m[2]];
  const hh = Number(m[3]);
  const mm = Number(m[4]);
  const yy = Number(ctxYear);

  if (!Number.isFinite(dd) || mon == null || !Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null;

  const d = new Date(Date.UTC(yy, mon, dd, hh, mm, 0));
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export default async function parse(source) {
  try {
    const s = source || {};
    const base = "https://www.malmoopera.se";
    const frontUrl = String(s.url || base);

    const frontRes = await httpGet(frontUrl);
    if (frontRes.status < 200 || frontRes.status >= 300) return [];

    const ds = extractDrupalSettings(frontRes.text);
    if (!ds) return [];

    const pick = pickAjaxView(ds);
    if (!pick) return [];
    const { ajaxPath, v } = pick;

    const payload = {
      view_name: v.view_name,
      view_display_id: v.view_display_id,
      view_args: v.view_args || "",
      view_path: v.view_path || "/node/37",
      view_dom_id: v.view_dom_id,
      pager_element: v.pager_element ?? 0,
    };

    const ajaxRes = await httpPostForm(base + ajaxPath, payload);
    if (ajaxRes.status < 200 || ajaxRes.status >= 300) return [];

    const merged = extractHtmlFragmentsFromViewsAjax(ajaxRes.text);
    if (!merged) return [];

    // Month headers give year context: "januari 2026"
    const headers = [];
    const hRe = />\s*(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})\s*</gi;
    let hm;
    while ((hm = hRe.exec(merged))) {
      headers.push({ idx: hm.index, year: Number(hm[2]) });
    }
    headers.sort((a, b) => a.idx - b.idx);

    function yearForIndex(i) {
      let y = new Date().getUTCFullYear();
      for (const h of headers) {
        if (h.idx <= i && Number.isFinite(h.year)) y = h.year;
        else if (h.idx > i) break;
      }
      return y;
    }

    // Instance blocks
    const rows = [];
    const instRe = /data-instance-id="(\d+)"[\s\S]*?<span[^>]*class="tag"[^>]*>([^<]+)<\/span>[\s\S]*?<a href="([^"]+)"[^>]*class="underline"[^>]*>[\s\S]*?<div[^>]*>([^<]+)<\/div>[\s\S]*?<a href="(https:\/\/biljetter\.malmoopera\.se\/events\/[^"]+)"[^>]*class="buy-button[^"]*"[^>]*>Köp<\/a>/gi;

    let m;
    while ((m = instRe.exec(merged))) {
      const tag = stripTags(m[2] || "");
      const relEvent = (m[3] || "").trim();
      const title = stripTags(m[4] || "");
      const ticket = (m[5] || "").trim();

      const ctxYear = yearForIndex(m.index);
      const start_at = parseStartAtFromTag(tag, ctxYear);
      if (!title || !start_at) continue;

      const eventUrl = absUrl(base, relEvent);

      const details = await getShowDetails(eventUrl);
      const finalTitle = (details.title || title || "").trim() || title;
      const finalDesc = details.description || null;
      let finalImg = details.image_url || null;
      if (finalImg && typeof finalImg === "string" && finalImg.startsWith("/")) finalImg = base + finalImg;

      rows.push({title,
        start_at,
        city: s.city || "Malmö",
        venue_name: "Malmö Opera",
        description: finalDesc,
        image_url: finalImg,
ticket_url: ticket || null,
        organizer_url: eventUrl || null,
        source_url: eventUrl || s.url || null,
        listing_url: s.url || null,
        category: s.category || "teater",
        subcategory: null,
      });
    }

    const seen = new Set();
    return rows.filter((r) => {
      const k = `${r.title}__${r.start_at}__${r.ticket_url || ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [];
  }
}

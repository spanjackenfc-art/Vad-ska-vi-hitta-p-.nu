import * as cheerio from "cheerio";

function cleanText(x) {
  if (!x) return "";
  return String(x).replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  return cleanText($.text());
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const t = cleanText(v);
    if (t) return t;
  }
  return "";
}

function extractJsonLdEvents($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        if (!it) continue;
        // JSON-LD kan vara @graph
        if (it["@graph"] && Array.isArray(it["@graph"])) {
          out.push(...it["@graph"]);
        } else {
          out.push(it);
        }
      }
    } catch {}
  });
  return out;
}

function pickSchemaEvent(jsonLdItems) {
  for (const it of jsonLdItems) {
    const t = (it["@type"] || it.type || "").toString().toLowerCase();
    if (t === "event") return it;
  }
  return null;
}

function extractOg($, key) {
  return (
    $(`meta[property="og:${key}"]`).attr("content") ||
    $(`meta[name="og:${key}"]`).attr("content") ||
    ""
  );
}

function extractAgeSignals(textRaw) {
  const t = (textRaw || "").toLowerCase();

  const mRange = t.match(/\b(\d{1,2})\s*[–-]\s*(\d{1,2})\b(?:\s*år)?/i);
  if (mRange) return { age_label: `${mRange[1]}–${mRange[2]} år`, age_min: Number(mRange[1]), age_max: Number(mRange[2]) };

  const mFrom = t.match(/\bfrån\s*(\d{1,2})\s*år\b/i);
  if (mFrom) return { age_label: `Från ${mFrom[1]} år`, age_min: Number(mFrom[1]), age_max: null };

  const mPlus = t.match(/\b(\d{1,2})\s*\+\b/);
  if (mPlus) return { age_label: null, age_min: null, age_max: null, age_restriction: `${mPlus[1]}+` };

  const mRestr = t.match(/\båldersgräns\s*(\d{1,2})\b/i);
  if (mRestr) return { age_label: null, age_min: null, age_max: null, age_restriction: `${mRestr[1]}+` };

  return {};
}

function extractDurationMinutes(textRaw) {
  const t = (textRaw || "").toLowerCase();

  // "1 tim 30 min", "1h 30", "90 min", "1,5 tim"
  const mMin = t.match(/\b(\d{2,3})\s*min\b/i);
  if (mMin) return Number(mMin[1]);

  const mHMin = t.match(/\b(\d{1,2})\s*(?:h|tim)\s*(\d{1,2})\s*min\b/i);
  if (mHMin) return Number(mHMin[1]) * 60 + Number(mHMin[2]);

  const mH = t.match(/\b(\d{1,2})(?:\s*(?:h|tim))\b/i);
  if (mH && !t.includes("min")) return Number(mH[1]) * 60;

  const mDec = t.match(/\b(\d)(?:[.,](\d))\s*(?:tim|h)\b/i);
  if (mDec) return Math.round((Number(mDec[1]) + Number(mDec[2]) / 10) * 60);

  return null;
}

function extractPriceText(textRaw) {
  const t = cleanText(textRaw);
  if (!t) return "";
  // behåll original men trimma
  return t;
}

function findMainHtml($) {
  // Försök hitta en "rimlig" huvudtext
  const selectors = [
    "main article",
    "article",
    "main",
    ".content",
    ".article",
    ".entry-content",
    ".page-content",
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el && el.length) {
      const html = el.html();
      const text = cleanText(el.text());
      if (text.length >= 200) return html || "";
    }
  }
  // fallback: body
  return $("body").html() || "";
}

function normalizeHtmlAssets(html, baseUrl) {
  if (!html) return html;
  let $ = cheerio.load(html);

  // Absolutifiera img src + srcset
  $("img").each((_, el) => {
    const $el = $(el);

    const src = $el.attr("src");
    if (src) {
      try { $el.attr("src", new URL(src, baseUrl).toString()); } catch {}
    }

    const srcset = $el.attr("srcset");
    if (srcset) {
      const parts = srcset.split(",").map(p => p.trim()).filter(Boolean);
      const mapped = parts.map(p => {
        const segs = p.split(/\s+/);
        const urlPart = segs[0];
        const rest = segs.slice(1).join(" ");
        try {
          const abs = new URL(urlPart, baseUrl).toString();
          return rest ? `${abs} ${rest}` : abs;
        } catch {
          return p;
        }
      });
      $el.attr("srcset", mapped.join(", "));
    }
  });

  return $.root().html() || html;
}


// Export: tar url + html och returnerar ett patch-objekt för events-tabellen
export function parseEventDetails({ url, html }) {
  const $ = cheerio.load(html);

  const jsonLdItems = extractJsonLdEvents($);
  const schemaEvent = pickSchemaEvent(jsonLdItems);

  // Title/description från schema först, annars OG
  const ogTitle = extractOg($, "title");
  const ogDesc = extractOg($, "description");
  const ogImage = extractOg($, "image");

  let descriptionHtml = "";
  let descriptionText = "";

  if (schemaEvent) {
    // schema description kan vara text, ibland HTML
    const desc = schemaEvent.description || "";
    if (typeof desc === "string") {
      descriptionText = cleanText(desc);
      // vi lagrar som text i description_text, och lämnar description_html tom om vi inte har HTML
      descriptionHtml = "";
    }
  }

  // Försök alltid få HTML från main om vi inte redan har descriptionHtml
  if (!descriptionHtml) {
    const mainHtml = findMainHtml($);
    descriptionHtml = cleanText(mainHtml) ? normalizeHtmlAssets(mainHtml, url) : "";
    // Om vi saknar text: derivat från HTML
    if (!descriptionText) descriptionText = stripHtmlToText(descriptionHtml);
  }

  if (!descriptionText) {
    descriptionText = firstNonEmpty(ogDesc);
  }

  const combinedForSignals = `${ogTitle} ${descriptionText}`;

  const age = extractAgeSignals(combinedForSignals);
  const duration_minutes = extractDurationMinutes(combinedForSignals);

  // Pris: vissa sidor har tydlig meta eller text nära "Pris"
  // Vi gör det enkelt nu: sök efter "Pris" i text och plocka kort substring
  let price_text = "";
  const bodyText = cleanText($("body").text());
  const mPrice = bodyText.match(/\bpris\b[^.:\n]{0,120}/i);
  if (mPrice) price_text = extractPriceText(mPrice[0]);

  const patch = {
    details_url: url,
    description_html: descriptionHtml || null,
    description_text: descriptionText || null,
    image_url: ogImage || null,
    price_text: price_text || null,
    duration_minutes: duration_minutes ?? null,    audience: null,
    age_label: age.age_label ?? null,
    age_min: Number.isFinite(age.age_min) ? age.age_min : null,
    age_max: Number.isFinite(age.age_max) ? age.age_max : null,
    age_restriction: age.age_restriction ?? null,
  };

  return patch;
}

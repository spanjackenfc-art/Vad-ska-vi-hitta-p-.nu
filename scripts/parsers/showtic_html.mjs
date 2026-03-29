function stripTags(x){
  return String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(s){
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absUrl(base, href){
  const h = String(href || "").trim();
  if(!h) return null;
  if(/^https?:\/\//i.test(h)) return h;
  if(h.startsWith("//")) return "https:" + h;
  try { return new URL(h, base).toString(); } catch { return h; }
}

function parseSvDateRange(s){
  const txt = String(s || "").toLowerCase().trim();
  const mon = {
    jan:"01", januari:"01",
    feb:"02", februari:"02",
    mar:"03", mars:"03",
    apr:"04", april:"04",
    maj:"05",
    jun:"06", juni:"06",
    jul:"07", juli:"07",
    aug:"08", augusti:"08",
    sep:"09", sept:"09", september:"09",
    okt:"10", oktober:"10",
    nov:"11", november:"11",
    dec:"12", december:"12"
  };

  const m = txt.match(/(\d{1,2})\s+([a-zåäö]+)/);
  if(!m) return null;

  const dd = String(m[1]).padStart(2, "0");
  const mm = mon[m[2]];
  if(!mm) return null;

  const now = new Date();
  let yyyy = now.getUTCFullYear();

  const candidate = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  if (!Number.isFinite(candidate.getTime())) return null;

  const threshold = new Date();
  threshold.setUTCDate(threshold.getUTCDate() - 40);
  if (candidate < threshold) yyyy += 1;

  return new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`).toISOString();
}

export default async function parse({ html, source }) {
  try{
    const h = String(html || "");
    const base = source?.url || "https://www.showtic.se/forestallningar";
    const rows = [];

    const re = /<li class="allShowsListItem_[^"]*"[\s\S]*?<a href="([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<div class="showDetails"><span>([\s\S]*?)<\/span><\/div>[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<\/a><\/li>/gi;

    let m;
    while((m = re.exec(h))){
      const url = absUrl(base, decodeHtml(m[1]));
      const image_url = decodeHtml(m[2]);
      const title = stripTags(decodeHtml(m[3]));
      const venue = stripTags(decodeHtml(m[4]));
      const dateText = stripTags(decodeHtml(m[5]));
      const start_at = parseSvDateRange(dateText);

      if(!title || !url || !start_at) continue;

      rows.push({
        title,
        start_at,
        city: null,
        venue_name: venue || null,
        description: null,
        image_url: image_url || null,
        ticket_url: url,
        organizer_url: url,
        source_url: url,
        listing_url: source?.url || null,
        category: source?.category || "teater",
        subcategory: null,
      });
    }

    const seen = new Set();
    return rows.filter(r => {
      const k = r.source_url || `${r.title}__${r.start_at}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }catch{
    return [];
  }
}

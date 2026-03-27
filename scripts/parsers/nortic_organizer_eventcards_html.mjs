function stripTags(x){
  return String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function absUrl(href){
  const u = String(href || "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return "https://www.nortic.se" + u;
  return u;
}

function firstDateFromFilterTags(s){
  const m = String(s || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!m) return null;
  const d = new Date(m[1] + "T12:00:00Z");
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function organizerIdFromUrl(url){
  const m = String(url || "").match(/\/ticket\/organizer\/(\d+)/i);
  return m ? m[1] : null;
}

async function fetchOrganizerCardsHtml(source){
  const organizerId = organizerIdFromUrl(source?.url);
  if (!organizerId) return null;

  const url = `https://www.nortic.se/dagny/ajax/organizer/eventcards/${organizerId}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
      "x-requested-with": "XMLHttpRequest"
    }
  });

  if (!res.ok) return null;
  return await res.text();
}

export default async function parse({ html, source }){
  try{
    let h = String(html || "");
    if (!/grid-item/i.test(h)) {
      const ajaxHtml = await fetchOrganizerCardsHtml(source);
      if (ajaxHtml) h = ajaxHtml;
    }
    const rows = [];
    const re = /<div class="grid-item"[^>]*data-filtertags="([^"]*)"[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<a href="([^"]*\/ticket\/event\/\d+)">[\s\S]*?<img src="([^"]*)"/gi;

    let m;
    while((m = re.exec(h))){
      const filtertags = m[1] || "";
      const title = stripTags(m[2] || "");
      const eventUrl = absUrl(m[3] || "");
      const imageUrl = absUrl(m[4] || "");
      const start_at = firstDateFromFilterTags(filtertags);

      if(!title || !eventUrl) continue;

      rows.push({
        title,
        start_at,
        city: source?.city || null,
        venue_name: "Nortic",
        description: null,
        image_url: imageUrl || null,
        ticket_url: eventUrl,
        organizer_url: source?.url || null,
        source_url: eventUrl,
        listing_url: source?.url || null,
        category: source?.category || null,
        subcategory: null,
      });
    }

    const seen = new Set();
    return rows.filter(r => {
      const k = `${r.title}__${r.source_url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }catch{
    return [];
  }
}

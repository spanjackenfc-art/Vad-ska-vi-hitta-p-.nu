const MONTHS = { jan:0,feb:1,mar:2,apr:3,maj:4,jun:5,jul:6,aug:7,sep:8,okt:9,nov:10,dec:11 };

function stripTags(x){
  return String(x||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

function parseFirstDate(s){
  const t=String(s||"").toLowerCase().replace(/\./g,"");
  const m=t.match(/(\d{1,2})\s+([a-zåäö]{3})\s+(\d{4})/i);
  if(!m) return null;
  const dd=Number(m[1]); const mon=MONTHS[m[2]]; const yy=Number(m[3]);
  if(!Number.isFinite(dd)||mon==null||!Number.isFinite(yy)) return null;
  const d=new Date(Date.UTC(yy,mon,dd,12,0,0));
  return Number.isFinite(d.getTime())?d.toISOString():null;
}

function absUrl(href){
  const u=String(href||"").trim();
  if(!u) return null;
  if(/^https?:\/\//i.test(u)) return u;
  if(u.startsWith("/")) return "https://www.opera.se"+u;
  return u;
}

/**
 * Försök extrahera PROGRAM_LISTING_BLOCK.pages ur SSR/Apollo HTML.
 * Vi letar efter programListingBlock och plockar ut JSON-arrayen under "pages":[...]
 */
function extractProgrammePagesFromHtml(html){
  const h=String(html||"");
  // Hittar: {"__typename":"programListingBlock", ... "pages":[{...},{...}], "themeColorVariant": ...}
  const m = h.match(/"__typename"\s*:\s*"programListingBlock"[\s\S]*?"pages"\s*:\s*(\[[\s\S]*?\])\s*,\s*"themeColorVariant"/i);
  if(!m) return null;

  const rawArray = m[1];
  try{
    const arr = JSON.parse(rawArray);
    return Array.isArray(arr) ? arr : null;
  }catch{
    return null;
  }
}

export default async function parse({ html, source }){
  try{
    const h=String(html||"");
    const rows=[];

    // 1) Primär: SSR/Apollo JSON -> programListingBlock.pages (pageSummary)
    const pages = extractProgrammePagesFromHtml(h);
    if(pages && pages.length){
      for(const p of pages){
        const name = String(p?.name || "").trim();
        const url = absUrl(p?.url);
        const meta = String(p?.meta || "");
        const start_at = parseFirstDate(meta); // tar första datumet i meta (t.ex. "27 sep. 2025 — ...")
        const tag = String(p?.tag || "").trim();

        if(!name || !url || !start_at) continue;

        // Enkel tag->category mapping, fallback till source.category
        const t = tag.toLowerCase();
        let category = source?.category || "teater";
        if(t === "opera") category = "opera";
        else if(t === "dans") category = "dans";
        else if(t === "musikal") category = "musikal";
        else if(t === "konsert") category = "konsert";
        else if(t === "barn & unga") category = "familj";

        rows.push({
          title: name,
          start_at,
          city: (source?.city) || "Göteborg",
          venue_name: "GöteborgsOperan",
          description: null,
          image_url: null,
          ticket_url: null,
          organizer_url: url,
          source_url: url,
          listing_url: source?.url || "https://www.opera.se/forestallningar/",
          category,
          subcategory: null,
        });
      }
    }

    // 2) Fallback: gammal HTML-anchor-regex (om site plötsligt ändrar render)
    if(!rows.length){
      const re=/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,700}?(\d{1,2}\s+[a-zåäö]{3}\.?\s+\d{4})/gi;
      let m2;
      while((m2=re.exec(h))){
        const href=(m2[1]||"").trim();
        const title=stripTags(m2[2]||"");
        const start_at=parseFirstDate(m2[3]||"");
        if(!title||!start_at) continue;
        const abs=absUrl(href);
        rows.push({
          title, start_at,
          city:(source?.city)||"Göteborg",
          venue_name:"GöteborgsOperan",
          description:null, image_url:null,
          ticket_url:null,
          organizer_url:abs||null,
          source_url:abs||source?.url||null,
          listing_url:source?.url||null,
          category:source?.category||"teater",
          subcategory:null,
        });
      }
    }

    const seen=new Set();
    return rows.filter(r=>{
      const k=`${r.title}__${r.start_at}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }catch{
    return [];
  }
}

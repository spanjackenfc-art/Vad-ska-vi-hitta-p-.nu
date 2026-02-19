const MONTHS = { jan:0,feb:1,mar:2,apr:3,maj:4,jun:5,jul:6,aug:7,sep:8,okt:9,nov:10,dec:11 };
function stripTags(x){ return String(x||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function parseFirstDate(s){
  const t=String(s||"").toLowerCase().replace(/\./g,"");
  const m=t.match(/(\d{1,2})\s+([a-zåäö]{3})\s+(\d{4})/i);
  if(!m) return null;
  const dd=Number(m[1]); const mon=MONTHS[m[2]]; const yy=Number(m[3]);
  if(!Number.isFinite(dd)||mon==null||!Number.isFinite(yy)) return null;
  const d=new Date(Date.UTC(yy,mon,dd,12,0,0));
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
export default async function parse({ html, source }){
  try{
    const h=String(html||"");
    const rows=[];
    const re=/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,700}?(\d{1,2}\s+[a-zåäö]{3}\.?\s+\d{4})/gi;
    let m;
    while((m=re.exec(h))){
      const href=(m[1]||"").trim();
      const title=stripTags(m[2]||"");
      const start_at=parseFirstDate(m[3]||"");
      if(!title||!start_at) continue;
      const abs=href.startsWith("http")?href:href;
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
    const seen=new Set();
    return rows.filter(r=>{const k=`${r.title}__${r.start_at}`; if(seen.has(k)) return false; seen.add(k); return true;});
  }catch{ return []; }
}

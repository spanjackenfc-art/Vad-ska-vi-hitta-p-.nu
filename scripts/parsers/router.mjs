import { importTickster } from "./tickster_html.mjs";
import { importKulturbiljetterSearch } from "./kulturbiljetter_search_html.mjs";
import { importKulturbiljetterArrangor } from "./kulturbiljetter_arrangor_html.mjs";
import showtic_html from "./showtic_html.mjs";
import goteborgsoperan_html from "./goteborgsoperan_html.mjs";
import malmostadsteater_html from "./malmostadsteater_html.mjs";
import malmoopera_html from "./malmoopera_html.mjs";
import html from "./html.mjs";
// Nästa tre bygger vi strax:
import { importWelma } from "./welma_html.mjs";
import { importBarnistan } from "./barnistan_html.mjs";
import { importDNKalendariet } from "./dn_kalendariet.mjs";
import { importStadsteatern } from "./stadsteatern_html.mjs";
import { importDramaten } from "./dramaten_html.mjs";
import { importOscarsteatern } from "./oscarsteatern_html.mjs";
import { importChinaTeatern } from "./chinateatern_html.mjs";
import { importFolkoperan } from "./folkoperan_html.mjs";
import malmolive_html from "./malmolive_html.mjs";
import { importTeaterbusAktuellt } from "./teaterbus_aktuellt_html.mjs";
import { importIntimanForestallningar } from "./intiman_forestallningar_html.mjs";
import { importOrionPaScen } from "./orion_pa_scen_html.mjs";
import { importPygmeSpelprogramHtml } from "./pygme_spelprogram_html.mjs";

export const HTML_PARSERS = {
  pygme_spelprogram_html: importPygmeSpelprogramHtml,
  showtic_html: showtic_html,
  malmoopera_html: malmoopera_html,
  malmostadsteater_html: malmostadsteater_html,
  goteborgsoperan_html: goteborgsoperan_html,
  html: html,
  musikal_html: html,
  o2scenkonst_html: html,
  tickster_html: importTickster,
  kulturbiljetter_arrangor_html: importKulturbiljetterArrangor,
  kulturbiljetter_search_html: importKulturbiljetterSearch,
  welma_html: importWelma,
  barnistan_html: importBarnistan,
  dn_kalendariet: importDNKalendariet,
  stadsteatern_html: importStadsteatern,
  dramaten_html: importDramaten,
  oscarsteatern_html: importOscarsteatern,
  chinateatern_html: importChinaTeatern,
  folkoperan_html: importFolkoperan,
  malmolive_html,
  teaterbus_aktuellt_html: importTeaterbusAktuellt,
  intiman_forestallningar_html: importIntimanForestallningar,
  orion_pa_scen_html: importOrionPaScen,

};

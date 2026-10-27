import "./lib/env.js";
import { campagnes } from "./campagnes/index.js";
import { rechercheGoogle } from "./lib/google.js";
import { propre } from "./lib/outils.js";

// npm run groupes -- agence : cherche des groupes Facebook PUBLICS liés à la campagne (via Google)
// et les affiche, à recopier dans la campagne après vérification.
const id = process.argv[2] ?? "agence";
const c = campagnes[id];
if (!c) throw new Error(`Campagne inconnue : ${id}`);

const resultats = await rechercheGoogle(c.facebook.decouverte, { parRequete: 10 });
const groupes = new Map<string, string>();
for (const r of resultats) {
  const m = r.url.match(/facebook\.com\/groups\/([^/?#]+)/);
  if (m && !groupes.has(m[1])) groupes.set(m[1], propre(r.titre).replace(/\s*\|\s*Facebook$/i, ""));
}
console.log(`${groupes.size} groupes trouvés (vérifie qu'ils sont publics et pertinents) :\n`);
for (const [slug, nom] of groupes) console.log(`      { nom: ${JSON.stringify(nom)}, url: "https://www.facebook.com/groups/${slug}/" },`);

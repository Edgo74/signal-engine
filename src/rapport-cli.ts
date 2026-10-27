import "./lib/env.js";
import { campagnes } from "./campagnes/index.js";
import { ecrireRapport } from "./rapport.js";
import { lireHistorique } from "./stockage.js";

// npm run rapport -- agence [jours]  : refait le rapport depuis l'historique, sans rien collecter ni noter.
const [id = "agence", jours = "30"] = process.argv.slice(2);
const c = campagnes[id];
if (!c) throw new Error(`Campagne inconnue : ${id}`);
const limite = Date.now() - Number(jours) * 86_400_000;
const signaux = lireHistorique(id).filter((s) => new Date(s.note_le).getTime() >= limite);
const { html, csv } = ecrireRapport(c, signaux, { historique: signaux.length }, []);
console.log(`${html}\n${csv}`);

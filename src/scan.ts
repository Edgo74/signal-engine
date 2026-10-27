import "./lib/env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { campagnes } from "./campagnes/index.js";
import { bilan, ouvrirBudget } from "./lib/couts.js";
import { enrichir } from "./entreprises.js";
import { enParallele, filtreRapide, noter } from "./notation.js";
import { ecrireRapport } from "./rapport.js";
import { sources } from "./sources/index.js";
import { enregistrer, lireHistorique, lireVus } from "./stockage.js";
import { RYTHMES, type Signal, type SignalNote, type SourceId } from "./types.js";

// npm run scan -- --campagne agence [--sources linkedin_posts,emplois] [--jours 7] [--forcer] [--test] [--tout] [--max 400] [--sans-ia] [--budget 2]
//   Par défaut, chaque source ne lit que ce qui est paru depuis son dernier passage réussi (data/<campagne>/etat.json),
//   7 jours au premier passage, et seulement si son rythme est écoulé (RYTHMES dans types.ts).
//   --jours    impose la fenêtre (en jours) au lieu de « depuis le dernier passage »
//   --forcer   lit les sources même si leur rythme n'est pas écoulé
//   --test     petit échantillon par source (quelques centimes) ; ne met pas à jour l'état
//   --tout     ignore la mémoire des signaux déjà vus
//   --max      nombre maximum de signaux envoyés à l'IA ; le reste attend le passage suivant
//   --sans-ia  collecte seulement, écrit les signaux bruts dans out/ ; ne met pas à jour l'état
//   --budget   plafond du jour en $ pour ce passage (sinon celui de la campagne)

const { values: a } = parseArgs({
  options: {
    campagne: { type: "string", default: "agence" },
    sources: { type: "string" },
    jours: { type: "string" },
    max: { type: "string", default: "400" },
    budget: { type: "string" },
    forcer: { type: "boolean", default: false },
    test: { type: "boolean", default: false },
    tout: { type: "boolean", default: false },
    "sans-ia": { type: "boolean", default: false },
  },
});

const campagne = campagnes[a.campagne!];
if (!campagne) throw new Error(`Campagne inconnue : ${a.campagne}. Disponibles : ${Object.keys(campagnes).join(", ")}`);
// --sources prime ; sinon les sources choisies pour ce client (campagne.sources) ; sinon toutes.
const voulues: string[] | undefined = a.sources ? a.sources.split(",") : campagne.sources;
const demandees = voulues ? sources.filter((s) => voulues.includes(s.id)) : sources;
const dossier = `data/${campagne.id}`;
mkdirSync(dossier, { recursive: true });
ouvrirBudget(campagne.id, { usdParJour: a.budget ? Number(a.budget) : campagne.budget.usdParJour, usdParMois: campagne.budget.usdParMois });

// État : date de début du dernier passage réussi, par source.
const fEtat = `${dossier}/etat.json`;
const etat: Partial<Record<SourceId, string>> = existsSync(fEtat) ? JSON.parse(readFileSync(fEtat, "utf8")) : {};
const debut = new Date();
const H = 3_600_000;

const choisies = demandees
  .map((s) => {
    const dernier = etat[s.id] ? new Date(etat[s.id]!) : null;
    const rythme = campagne.rythmes?.[s.id] ?? RYTHMES[s.id];
    const ecoule = dernier ? (debut.getTime() - dernier.getTime()) / H : Infinity;
    if (ecoule < rythme && !a.forcer && !a.jours && !a.test) {
      console.log(`  · ${s.nom} : lu il y a ${Math.round(ecoule)} h, prochain passage dans ${Math.ceil(rythme - ecoule)} h`);
      return null;
    }
    const depuis = a.jours ? new Date(debut.getTime() - Number(a.jours) * 24 * H) : (dernier ?? new Date(debut.getTime() - 7 * 24 * H));
    const jours = Math.max(1, Math.ceil((debut.getTime() - depuis.getTime()) / (24 * H)));
    return { s, options: { depuis, jours, test: a.test! } };
  })
  .filter((x) => x !== null);

console.log(`▶ ${campagne.nom} · ${choisies.length} source(s) à lire${a.test ? " · MODE TEST" : ""}`);

// 1. Collecte : toutes les sources en parallèle ; une source en panne n'arrête pas les autres.
const erreurs: string[] = [];
const stats: Record<string, number> = {};
const reussies: SourceId[] = [];
const resultats = await Promise.allSettled(
  choisies.map(async ({ s, options }) => {
    const t = Date.now();
    const sig = await s.collecter(campagne, options);
    console.log(`  ✓ ${s.nom} : ${sig.length} signaux depuis ${options.depuis.toISOString().slice(0, 16).replace("T", " ")} (${Math.round((Date.now() - t) / 1000)} s)`);
    stats[s.id] = sig.length;
    reussies.push(s.id);
    return sig;
  }),
);
resultats.forEach((r, i) => {
  if (r.status === "rejected") {
    const msg = `${choisies[i].s.nom} : ${r.reason instanceof Error ? r.reason.message : r.reason}`;
    erreurs.push(msg);
    console.warn(`  ✗ ${msg}`);
  }
});

// 2. Dédoublonnage (dans le passage et avec les passages précédents), plus les signaux restés en attente.
const fAttente = `${dossier}/attente.json`;
const attente: Signal[] = existsSync(fAttente) ? JSON.parse(readFileSync(fAttente, "utf8")) : [];
const vus = a.tout ? new Set<string>() : lireVus(campagne.id);
const uniques = new Map<string, Signal>();
const collectes = resultats.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
for (const s of [...attente, ...collectes]) if (!vus.has(s.id) && !uniques.has(s.id)) uniques.set(s.id, s);
const nouveaux = [...uniques.values()].sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
console.log(`  ${nouveaux.length} nouveaux signaux${attente.length ? ` (dont jusqu'à ${attente.length} en attente du passage précédent)` : ""}`);

if (a["sans-ia"]) {
  mkdirSync("out", { recursive: true });
  const f = `out/${campagne.id}-bruts.json`;
  writeFileSync(f, JSON.stringify(nouveaux, null, 2));
  console.log(`  → ${f}\n${bilan()}`);
  process.exit(0);
}

// 3. Notation IA (plafonnée par --max). Ce qui n'est pas noté attend le passage suivant :
// la fenêtre suivante ne relira pas ces signaux, il ne faut donc pas les perdre.
const aNoter = nouveaux.slice(0, Number(a.max));

// Fiche de chaque entreprise nommée (registre officiel gratuit, LinkedIn en complément) pour les signaux que le filtre garde.
const aEnrichir = aNoter.filter((s) => !filtreRapide(campagne, s));
if (aEnrichir.length) {
  const t = Date.now();
  const b = await enrichir(aEnrichir, { maxLinkedin: a.test ? 2 : (campagne.fichesLinkedinMax ?? 20) });
  console.log(`  fiches entreprise : ${b.registre} registre · ${b.linkedin} LinkedIn · ${b.sans} sans fiche (${Math.round((Date.now() - t) / 1000)} s)`);
}
const reportes = nouveaux.slice(aNoter.length);
if (reportes.length) console.log(`  ${reportes.length} signaux laissés pour le prochain passage (--max)`);
let fait = 0;
const echecs: Signal[] = [];
const notes = (
  await enParallele(aNoter, 8, async (s): Promise<SignalNote | null> => {
    try {
      const notation = await noter(campagne, s);
      if (++fait % 25 === 0) console.log(`  … ${fait}/${aNoter.length} notés`);
      return { ...s, notation, note_le: new Date().toISOString() };
    } catch (e) {
      erreurs.push(`Notation ${s.id} : ${e instanceof Error ? e.message : e}`);
      echecs.push(s);
      return null;
    }
  })
).filter((s): s is SignalNote => s !== null);

const historique = lireHistorique(campagne.id); // lu avant d'ajouter ce passage
enregistrer(campagne.id, vus, notes);
if (!a.test) {
  writeFileSync(fAttente, JSON.stringify([...reportes, ...echecs], null, 2));
  for (const id of reussies) etat[id] = debut.toISOString();
  writeFileSync(fEtat, JSON.stringify(etat, null, 2));
}

// 4. Rapport.
const { html, csv } = ecrireRapport(campagne, notes, stats, erreurs, historique);
const compte = (n: string) => notes.filter((s) => s.notation.note === n).length;
console.log(`\n✔ ${notes.length} notés : ${compte("A")} A · ${compte("B")} B · ${compte("X")} X`);
console.log(`  ${html}\n  ${csv}`);
if (erreurs.length) console.log(`  ${erreurs.length} erreur(s), voir le rapport`);
console.log(bilan());

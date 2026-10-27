import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lancerActeur } from "./lib/apify.js";
import { cleEntreprise, fetchRobuste, pause } from "./lib/outils.js";
import type { FicheEntreprise, Signal } from "./types.js";

// Fiche de l'entreprise avant la notation, pour que l'IA juge sur des faits (taille, activité) et pas sur une devinette :
//   1. registre officiel (API Recherche d'Entreprises, gratuite) : SIREN, code NAF, effectif, établissements ouverts ;
//   2. sinon, page LinkedIn de l'entreprise (harvestapi/linkedin-company, 0,004 $ la fiche), seulement quand la source
//      donne le lien exact de la page : la recherche LinkedIn par nom renvoie souvent une autre entreprise (« AGRO DIGITAL »
//      → une start-up ivoirienne, essai du 16/10).
// Les fiches sont gardées dans data/entreprises.json (commun à toutes les campagnes) : chaque entreprise n'est cherchée qu'une fois.

const FICHIER = "data/entreprises.json";
const GARDE_JOURS = 90;
type Cache = Record<string, { le: string; fiche: FicheEntreprise | null }>;

// Codes NAF des agences d'intérim et cabinets de placement : jamais une cible, ce sont des intermédiaires.
export const NAF_INTERMEDIAIRES = ["78.10Z", "78.20Z", "78.30Z"];

const EFFECTIFS: Record<string, string> = {
  "00": "0 salarié",
  "01": "1 à 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés et plus",
};

// Noms que les sources mettent à la place d'une vraie entreprise.
const ANONYME = /^(confidentiel|anonyme|entreprise|societe|non communique|nc|notre client|client|groupe|recrutement)$/;

const compact = (s: string) => cleEntreprise(s).replace(/\s+/g, "");

// Le nom trouvé doit vraiment être celui cherché : égalité, ou l'un commence par l'autre (à partir de 5 lettres ; « ECG » ≠ « ECG SECURITE »
// si trop court). Mieux vaut pas de fiche qu'une fiche fausse.
function memeNom(cherche: string, trouves: (string | null | undefined)[]) {
  const a = compact(cherche);
  if (a.length < 2) return false;
  return trouves.some((t) => {
    const b = t ? compact(t) : "";
    if (!b) return false;
    if (a === b) return true;
    const [court, long] = a.length < b.length ? [a, b] : [b, a];
    return court.length >= 5 && long.startsWith(court);
  });
}

// La recherche par nom peut tomber sur un homonyme (« Michael Page » → une PME du BTP de l'Indre, « ECG » → un organisme
// de formation, essai du 16/10). Règles :
//   - nom de moins de 5 lettres : pas de recherche ;
//   - plusieurs entreprises portent ce nom : on garde la plus grande, marquée `sur: false` (homonyme possible) ;
//   - une seule : `sur: true`. Seules les fiches sûres déclenchent une exclusion automatique.
async function registre(nom: string): Promise<FicheEntreprise | null> {
  if (compact(nom).length < 5) return null;
  const p = new URLSearchParams({ q: nom, per_page: "10", etat_administratif: "A" });
  const r = await fetchRobuste(`https://recherche-entreprises.api.gouv.fr/search?${p}`);
  if (!r.ok) throw new Error(`registre : erreur ${r.status}`);
  const { results = [] } = (await r.json()) as { results?: any[] };
  const candidats = results.filter((x) => memeNom(nom, [x.nom_complet, x.nom_raison_sociale, x.sigle, ...(x.siege?.liste_enseignes ?? [])]));
  if (!candidats.length) return null;
  const taille = (x: any) => (/^\d+$/.test(x.tranche_effectif_salarie ?? "") ? Number(x.tranche_effectif_salarie) : -1);
  const e = candidats.sort((x, y) => taille(y) - taille(x))[0];
  return {
    source: "registre",
    sur: candidats.length === 1,
    nom: e.nom_complet,
    siren: e.siren,
    naf: e.activite_principale ?? null,
    effectif: EFFECTIFS[e.tranche_effectif_salarie] ?? null,
    categorie: e.categorie_entreprise ?? null,
    etablissements: e.nombre_etablissements_ouverts ?? null,
    ville: e.siege?.libelle_commune ?? null,
    secteur: e.activite_principale ? (DIVISIONS_NAF[e.activite_principale.slice(0, 2)] ?? null) : null,
    linkedin: null,
  };
}

// Libellé des divisions NAF (2 premiers chiffres), pour que l'IA et le lecteur voient l'activité sans connaître les codes.
const DIVISIONS_NAF: Record<string, string> = {
  "01": "agriculture", "02": "sylviculture", "03": "pêche", "05": "extraction", "06": "extraction", "07": "extraction", "08": "extraction",
  "09": "services aux industries extractives", "10": "industrie alimentaire", "11": "fabrication de boissons", "12": "industrie du tabac",
  "13": "industrie textile", "14": "habillement", "15": "cuir et chaussure", "16": "travail du bois", "17": "industrie du papier", "18": "imprimerie",
  "19": "raffinage", "20": "industrie chimique", "21": "industrie pharmaceutique", "22": "caoutchouc et plastique", "23": "minéraux non métalliques",
  "24": "métallurgie", "25": "produits métalliques", "26": "électronique", "27": "équipements électriques", "28": "machines et équipements",
  "29": "industrie automobile", "30": "autres matériels de transport", "31": "fabrication de meubles", "32": "autres industries manufacturières",
  "33": "réparation et installation de machines", "35": "énergie", "36": "eau", "37": "assainissement", "38": "déchets", "39": "dépollution",
  "41": "construction de bâtiments", "42": "génie civil", "43": "travaux de construction spécialisés", "45": "commerce et réparation automobile",
  "46": "commerce de gros", "47": "commerce de détail", "49": "transport terrestre", "50": "transport par eau", "51": "transport aérien",
  "52": "entreposage et logistique", "53": "poste et courrier", "55": "hébergement", "56": "restauration", "58": "édition", "59": "audiovisuel",
  "60": "radio et télévision", "61": "télécommunications", "62": "informatique", "63": "services d'information", "64": "services financiers",
  "65": "assurance", "66": "auxiliaires financiers", "68": "activités immobilières", "69": "juridique et comptable",
  "70": "sièges sociaux et conseil de gestion", "71": "architecture et ingénierie", "72": "recherche", "73": "publicité et études de marché",
  "74": "autres activités spécialisées", "75": "vétérinaire", "77": "location", "78": "emploi (intérim, placement)", "79": "agences de voyage",
  "80": "sécurité", "81": "services aux bâtiments (nettoyage, facility)", "82": "services administratifs", "84": "administration publique",
  "85": "enseignement", "86": "santé", "87": "hébergement médico-social", "88": "action sociale", "90": "arts et spectacles",
  "91": "bibliothèques et musées", "92": "jeux", "93": "sport et loisirs", "94": "associations", "95": "réparation de biens",
  "96": "autres services personnels", "97": "ménages employeurs", "99": "organisations extraterritoriales",
};

async function linkedin(urls: string[]): Promise<Map<string, FicheEntreprise>> {
  const out = new Map<string, FicheEntreprise>();
  if (!urls.length) return out;
  const lignes = await lancerActeur<any>("harvestapi/linkedin-company", { companies: urls }, { estimation: urls.length * 0.004 + 0.001 });
  for (const l of lignes) {
    const nom = l.universalName ? urls.find((u) => u.toLowerCase().includes(`/company/${String(l.universalName).toLowerCase()}`)) : undefined;
    const cle = nom ?? l.originalQuery?.url ?? l.linkedinUrl;
    if (!cle) continue;
    const t = l.employeeCountRange;
    out.set(cle, {
      source: "linkedin",
      sur: true, // lue à partir du lien exact de la page
      nom: l.name,
      siren: null,
      naf: null,
      effectif: t ? `${t.start}${t.end ? ` à ${t.end}` : " et plus"} salariés (LinkedIn)` : null,
      categorie: null,
      etablissements: Array.isArray(l.locations) && l.locations.length ? l.locations.length : null,
      ville: l.locations?.[0]?.city ?? null,
      secteur: (l.industries ?? []).map((i: any) => i.name).filter(Boolean).join(", ") || null,
      linkedin: l.linkedinUrl ?? cle,
    });
  }
  return out;
}

const urlPage = (u: string) => u.replace(/^https?:\/\/[a-z]{2,3}\.linkedin\.com/, "https://www.linkedin.com").replace(/[?#].*$/, "").replace(/\/?$/, "/");

// Ajoute `fiche` aux signaux qui nomment une entreprise. maxLinkedin = nombre de fiches LinkedIn payantes au plus.
export async function enrichir(signaux: Signal[], o: { maxLinkedin: number }): Promise<{ registre: number; linkedin: number; sans: number }> {
  mkdirSync("data", { recursive: true });
  const cache: Cache = existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, "utf8")) : {};
  const frais = (k: string) => cache[k] && Date.now() - new Date(cache[k].le).getTime() < GARDE_JOURS * 86_400_000;
  const maintenant = new Date().toISOString();

  // 1. Registre, une fois par nom.
  const noms = new Map<string, string>();
  for (const s of signaux) {
    const k = s.entreprise ? cleEntreprise(s.entreprise) : "";
    if (k && !ANONYME.test(k)) noms.set(k, s.entreprise!);
  }
  for (const [k, nom] of noms) {
    if (frais(k)) continue;
    try {
      cache[k] = { le: maintenant, fiche: await registre(nom) };
    } catch (e) {
      console.warn(`  ⚠ registre « ${nom} » : ${e instanceof Error ? e.message : e}`);
    }
    await pause(150); // l'API accepte 7 appels par seconde
  }

  // 2. LinkedIn quand le registre n'a pas de fiche sûre, si on a le lien exact de la page.
  const aChercher = new Map<string, string>(); // url → clé du nom
  for (const s of signaux) {
    if (!s.entreprise || !s.entrepriseLinkedin) continue;
    const k = cleEntreprise(s.entreprise);
    if (cache[k]?.fiche?.sur) continue;
    const u = urlPage(s.entrepriseLinkedin);
    if (frais(`li:${u}`)) continue;
    aChercher.set(u, k);
  }
  const urls = [...aChercher.keys()].slice(0, o.maxLinkedin);
  if (urls.length) {
    try {
      const fiches = await linkedin(urls);
      for (const u of urls) {
        const f = fiches.get(u) ?? null;
        cache[`li:${u}`] = { le: maintenant, fiche: f };
      }
    } catch (e) {
      console.warn(`  ⚠ fiches LinkedIn : ${e instanceof Error ? e.message : e}`);
    }
  }
  writeFileSync(FICHIER, JSON.stringify(cache, null, 1));

  const bilan = { registre: 0, linkedin: 0, sans: 0 };
  for (const s of signaux) {
    if (!s.entreprise) continue;
    const reg = cache[cleEntreprise(s.entreprise)]?.fiche ?? null;
    const li = s.entrepriseLinkedin ? (cache[`li:${urlPage(s.entrepriseLinkedin)}`]?.fiche ?? null) : null;
    const f = reg?.sur ? reg : (li ?? reg);
    if (f) {
      s.fiche = f;
      bilan[f.source]++;
    } else bilan.sans++;
  }
  return bilan;
}

// Ligne lisible pour l'IA et le rapport.
export const resumeFiche = (f: FicheEntreprise) =>
  [
    f.nom,
    f.siren && `SIREN ${f.siren}`,
    f.naf && `NAF ${f.naf}`,
    f.secteur,
    !f.sur && "homonyme possible",
    f.categorie,
    f.effectif,
    f.etablissements != null && `${f.etablissements} établissement${f.etablissements > 1 ? "s" : ""} ${f.source === "registre" ? "ouverts" : "sur LinkedIn"}`,
    f.ville && `siège : ${f.ville}`,
  ]
    .filter(Boolean)
    .join(" · ");

import { lancerActeur, PRIX } from "../lib/apify.js";
import { requis } from "../lib/env.js";
import { fetchRobuste, isoOuNull, pause, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Offres d'emploi = signal de compte : une entreprise qui recrute un responsable maintenance / travaux / FM
// réorganise sa maintenance. Sources : France Travail (API officielle), Adzuna (agrège Indeed…), LinkedIn Jobs via Apify (option de campagne).

async function franceTravail(motsCles: string[], jours: number): Promise<Signal[]> {
  const res = await fetchRobuste("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requis("FRANCE_TRAVAIL_CLIENT_ID"),
      client_secret: requis("FRANCE_TRAVAIL_CLIENT_SECRET"),
      scope: "api_offresdemploiv2 o2dsoffre",
    }),
  });
  if (!res.ok) throw new Error(`authentification refusée (${res.status})`);
  const jeton = ((await res.json()) as { access_token: string }).access_token;
  const publiee = jours <= 1 ? 1 : jours <= 3 ? 3 : jours <= 7 ? 7 : jours <= 14 ? 14 : 31;

  const out: Signal[] = [];
  for (const mot of motsCles) {
    const p = new URLSearchParams({ motsCles: mot, publieeDepuis: String(publiee), range: "0-149" });
    const r = await fetchRobuste(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${p}`, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" },
    });
    if (r.status === 204) continue;
    if (!r.ok && r.status !== 206) {
      console.warn(`  ⚠ France Travail « ${mot} » : erreur ${r.status}`);
      continue;
    }
    const { resultats = [] } = (await r.json()) as { resultats?: any[] };
    for (const o of resultats) {
      out.push({
        id: `emplois:ft:${o.id}`,
        source: "emplois",
        plateforme: "France Travail",
        type: "offre_emploi",
        date: isoOuNull(o.dateCreation),
        url: `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
        titre: o.intitule,
        texte: `${o.lieuTravail?.libelle ?? ""} · ${o.typeContratLibelle ?? ""}\n${propre(o.description).slice(0, 2500)}`,
        entreprise: o.entreprise?.nom ?? null,
        personne: null,
        requete: mot,
      });
    }
    await pause(250);
  }
  return out;
}

async function adzuna(motsCles: string[], jours: number): Promise<Signal[]> {
  const appId = requis("ADZUNA_APP_ID");
  const appKey = requis("ADZUNA_APP_KEY");
  const out: Signal[] = [];
  for (const mot of motsCles) {
    const p = new URLSearchParams({ app_id: appId, app_key: appKey, what_phrase: mot, max_days_old: String(jours), results_per_page: "50", sort_by: "date" });
    const r = await fetchRobuste(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${p}`);
    if (!r.ok) {
      console.warn(`  ⚠ Adzuna « ${mot} » : erreur ${r.status}`);
      continue;
    }
    const { results = [] } = (await r.json()) as { results?: any[] };
    for (const o of results) {
      out.push({
        id: `emplois:adzuna:${o.id}`,
        source: "emplois",
        plateforme: "Adzuna",
        type: "offre_emploi",
        date: isoOuNull(o.created),
        url: o.redirect_url ?? null,
        titre: propre(o.title),
        texte: `${o.location?.display_name ?? ""}\n${propre(o.description)}`,
        entreprise: o.company?.display_name ?? null,
        personne: null,
        requete: mot,
      });
    }
    await pause(300);
  }
  return out;
}

// LinkedIn Jobs via valig/linkedin-jobs-scraper : droits limités sur le compte Apify (harvestapi/linkedin-job-search
// demande l'accès complet au compte : écarté le 16/10), 0,0004 $ l'offre + 0,001 $ par lancement. Un lancement par mot-clé.
async function linkedinJobs(motsCles: string[], jours: number, parMotCle: number): Promise<Signal[]> {
  const datePosted = jours <= 1 ? "r86400" : jours <= 7 ? "r604800" : "r2592000";
  const lots = await Promise.allSettled(
    motsCles.map((mot) =>
      lancerActeur<any>("valig/linkedin-jobs-scraper", { keywords: mot, location: "France", datePosted, limit: parMotCle }, { estimation: parMotCle * PRIX.offreLinkedin + 0.001 }).then(
        (lignes) => lignes.map((l) => ({ ...l, mot })),
      ),
    ),
  );
  lots.forEach((l, i) => l.status === "rejected" && console.warn(`  ⚠ LinkedIn Jobs « ${motsCles[i]} » : ${l.reason}`));
  return lots
    .flatMap((l) => (l.status === "fulfilled" ? l.value : []))
    .filter((l) => l.id && l.title)
    .map(
      (l): Signal => ({
        id: `emplois:linkedin:${l.id}`,
        source: "emplois",
        plateforme: "LinkedIn Jobs",
        type: "offre_emploi",
        date: isoOuNull(l.postedDate),
        url: l.url ?? null,
        titre: propre(l.title),
        texte: `${l.location ?? ""}${l.workType ? ` · secteur LinkedIn : ${l.workType}` : ""}
${propre(l.description).slice(0, 2500)}`,
        entreprise: l.companyName || null,
        entrepriseLinkedin: l.companyUrl || undefined,
        personne: null,
        requete: l.mot,
        contexte: l.recruiterName ? `Offre publiée par ${l.recruiterName} sur LinkedIn` : undefined,
      }),
    );
}

export const emplois: Source = {
  id: "emplois",
  nom: "Offres d'emploi (France Travail, Adzuna, LinkedIn Jobs)",
  async collecter(c, o) {
    const mots = o.test ? c.emplois.motsCles.slice(0, 2) : c.emplois.motsCles;
    const noms = ["France Travail", "Adzuna", "LinkedIn Jobs"];
    const lots = await Promise.allSettled([
      franceTravail(mots, o.jours),
      adzuna(mots, o.jours),
      c.emplois.apifyLinkedIn ? linkedinJobs(mots, o.jours, o.test ? 3 : (c.emplois.linkedinParMotCle ?? 25)) : Promise.resolve([]),
    ]);
    lots.forEach((l, i) => l.status === "rejected" && console.warn(`  ⚠ ${noms[i]} : ${l.reason}`));
    return lots.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
  },
};

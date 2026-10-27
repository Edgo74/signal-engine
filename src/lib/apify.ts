import { reserver } from "./couts.js";
import { requis } from "./env.js";
import { fetchRobuste, pause } from "./outils.js";

// Prix unitaires (USD) pour ESTIMER un passage avant de le lancer (plafond du jour).
// Le coût réel est relu sur l'exécution Apify à la fin et enregistré dans data/<campagne>/couts.jsonl.
export const PRIX = {
  linkedinPost: 0.002, // harvestapi, par post
  linkedinCommentaire: 0.002, // harvestapi, par commentaire
  linkedinReaction: 0.002,
  googlePage: 0.004, // apify/google-search-scraper, par page de résultats
  facebookPost: 0.006, // apify/facebook-groups-scraper (déduit du 13/10, à recaler)
  mapsLieu: 0.004, // compass/crawler-google-places
  mapsAvis: 0.0006,
  offreLinkedin: 0.0004, // valig/linkedin-jobs-scraper, par offre
  redditPost: 0.004, // trudax/reddit-scraper-lite
  redditDemarrage: 0.02, // trudax : 0,02 $ par Go de mémoire au lancement (on lance avec 1 Go)
  tweet: 0.00025, // kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest
  facebookPagePost: 0.005, // apify/facebook-posts-scraper
  facebookCommentaire: 0.0025, // apify/facebook-comments-scraper
};

type Run = {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
  pricingInfo?: { pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number; eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd: number }> }> } };
};

// Coût réel d'une exécution : événements facturés (acteurs « pay per event ») ou consommation de la plateforme.
// On prend le plus grand des deux : mieux vaut surestimer pour tenir le plafond.
function coutReel(r: Run): number {
  const evenements = r.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  let ppe = 0;
  for (const [ev, n] of Object.entries(r.chargedEventCounts ?? {})) {
    const e = evenements[ev];
    ppe += n * (e?.eventPriceUsd ?? e?.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? 0);
  }
  return Math.max(ppe, r.usageTotalUsd ?? 0);
}

// Lance un acteur Apify, attend la fin (jusqu'à `minutes`) et renvoie les lignes du dataset.
// `estimation` (USD) est réservée sur le budget du jour avant le lancement : si elle dépasse, rien n'est lancé.
export async function lancerActeur<T = Record<string, unknown>>(acteur: string, input: unknown, o: { estimation: number; minutes?: number; memoire?: number }): Promise<T[]> {
  const token = requis("APIFY_TOKEN");
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const id = acteur.replace("/", "~");
  const minutes = o.minutes ?? 15;
  const terminer = reserver(acteur, o.estimation);
  const lireRun = async (runId: string) => ((await (await fetchRobuste(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: h })).json()) as { data: Run }).data;

  let run: Run;
  try {
    // Plan gratuit : 5 exécutions simultanées au plus. Si la limite est atteinte, on attend une place.
    let start = await fetchRobuste(`https://api.apify.com/v2/acts/${id}/runs${o.memoire ? `?memory=${o.memoire}` : ""}`, { method: "POST", headers: h, body: JSON.stringify(input) });
    for (let essai = 0; start.status === 402 && essai < 60; essai++) {
      const corps = await start.text();
      if (!corps.includes("concurrent-runs-limit")) throw new Error(`Apify ${acteur} : lancement refusé (402) ${corps.slice(0, 200)}`);
      await pause(15_000);
      start = await fetchRobuste(`https://api.apify.com/v2/acts/${id}/runs${o.memoire ? `?memory=${o.memoire}` : ""}`, { method: "POST", headers: h, body: JSON.stringify(input) });
    }
    if (!start.ok) throw new Error(`Apify ${acteur} : lancement refusé (${start.status}) ${(await start.text()).slice(0, 200)}`);
    run = ((await start.json()) as { data: Run }).data;
  } catch (e) {
    terminer(0);
    throw e;
  }

  const fin = Date.now() + minutes * 60_000;
  while (Date.now() < fin) {
    await pause(5000);
    run = await lireRun(run.id);
    if (!["READY", "RUNNING"].includes(run.status)) break;
  }
  if (["READY", "RUNNING"].includes(run.status)) {
    await fetchRobuste(`https://api.apify.com/v2/actor-runs/${run.id}/abort`, { method: "POST", headers: h });
    console.warn(`  ⚠ ${acteur} arrêté après ${minutes} min, on garde ce qui a été récupéré`);
    await pause(3000);
    run = await lireRun(run.id);
  } else if (run.status !== "SUCCEEDED") {
    console.warn(`  ⚠ ${acteur} terminé avec le statut ${run.status}`);
  }

  const lignes: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetchRobuste(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&offset=${offset}&limit=1000`, { headers: h });
    const page = (await r.json()) as T[];
    lignes.push(...page);
    if (page.length < 1000) break;
  }
  // Apify compte les événements facturés quelques secondes après la fin (essai du 16/10 : X et Facebook relevés à 0) :
  // tant qu'aucun résultat n'est facturé alors qu'il y a des lignes, on relit l'exécution.
  const factures = () => Object.entries(run.chargedEventCounts ?? {}).filter(([e]) => !/start/i.test(e)).reduce((s, [, n]) => s + n, 0);
  for (let essai = 0; essai < 4 && lignes.length && run.pricingInfo?.pricingPerEvent && !factures(); essai++) {
    await pause(4000);
    run = await lireRun(run.id);
  }
  terminer(coutReel(run), `${lignes.length} lignes, estimé ${o.estimation.toFixed(3)} $`);
  return lignes;
}

import "./lib/env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { campagnes } from "./campagnes/index.js";
import { bilan, ouvrirBudget } from "./lib/couts.js";
import { appelerOpenAI } from "./lib/openai.js";
import { cleEntreprise } from "./lib/outils.js";
import { enParallele } from "./notation.js";
import { comptes, type Compte } from "./rapport.js";
import { lireHistorique } from "./stockage.js";
import type { Campagne } from "./types.js";

// npm run fiches -- agence [jours] [nombre]
// Deuxième passage IA, sur les entreprises A/B seulement (aucune collecte, aucun coût Apify) :
// une fiche par entreprise, prête à appeler, triée par chance de décrocher un rendez-vous.
//
// La note A/B juge UN signal (« ce texte révèle-t-il un besoin ? »).
// La chance juge l'ENTREPRISE pour le commercial : besoin direct, taille du réseau, personne nommée, fraîcheur, porte ouverte.

export type Chance = "haute" | "moyenne" | "faible";

export type Fiche = {
  chance: Chance;
  chance_score: number;
  raison_chance: string;
  entreprise: string;
  reseau: string;
  declencheur: string;
  pourquoi_maintenant: string;
  qui_appeler: string;
  comment_le_trouver: string;
  phrase_ouverture: string;
  a_verifier: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chance", "chance_score", "raison_chance", "entreprise", "reseau", "declencheur", "pourquoi_maintenant", "qui_appeler", "comment_le_trouver", "phrase_ouverture", "a_verifier"],
  properties: {
    chance: { type: "string", enum: ["haute", "moyenne", "faible"] },
    chance_score: { type: "integer", description: "0 à 100, pour trier dans une même chance." },
    raison_chance: { type: "string", description: "Une phrase : pourquoi cette chance (ce qui la monte, ce qui la baisse)." },
    entreprise: { type: "string", description: "Nom propre de l'entreprise à appeler." },
    reseau: { type: "string", description: "Ce que le texte dit du réseau (« 80 points de vente en Île-de-France »). « Taille inconnue » sinon. N'invente pas de chiffre." },
    declencheur: { type: "string", description: "Le fait daté qui déclenche l'appel, en une phrase concrète (« Le 8 octobre, publie une offre de Coordinateur maintenance boutiques… »)." },
    pourquoi_maintenant: { type: "string", description: "1 à 2 phrases : en quoi ce fait crée un besoin que le vendeur peut couvrir, maintenant." },
    qui_appeler: { type: "string", description: "La personne nommée dans les signaux si c'est un décideur (nom + poste), sinon l'intitulé de poste à viser." },
    comment_le_trouver: { type: "string", description: "Comment obtenir le contact : profil LinkedIn donné, recherche Apollo « poste + entreprise », standard du siège… Une phrase." },
    phrase_ouverture: { type: "string", description: "Ce que le commercial dit dans les 15 premières secondes au téléphone, vouvoiement, qui part du fait public sans paraître intrusif. 2 phrases maximum. N'invente aucun client ni chiffre." },
    a_verifier: { type: "string", description: "Ce qu'il faut vérifier avant d'appeler (le poste est-il pourvu ? l'annonce vient-elle d'un cabinet ? l'entreprise a-t-elle déjà un contrat national ?). Une phrase." },
  },
} as const;

const formater = (k: Compte) =>
  [
    `Entreprise : ${k.entreprise} · secteur : ${k.secteur} · réseau estimé : ${k.sites}`,
    ...k.signaux.slice(0, 5).map((s, i) =>
      [
        `--- Signal ${i + 1} (note ${s.notation.note}${s.notation.score}, ${s.plateforme}, ${s.date?.slice(0, 10) ?? "date inconnue"})`,
        s.personne && `Personne : ${s.personne.nom} — ${s.personne.poste ?? "poste inconnu"}`,
        s.contexte && `Contexte : ${s.contexte}`,
        `Titre : ${s.titre}`,
        `Texte : ${s.texte.slice(0, 2000)}`,
        `Analyse du premier passage : ${s.notation.pourquoi}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");

async function ficher(c: Campagne, k: Compte, aujourdhui: string): Promise<Fiche> {
  const f = await appelerOpenAI<Fiche>(
    [
      {
        role: "system",
        content: `Tu prépares des fiches d'appel pour le dirigeant d'une entreprise B2B qui va téléphoner lui-même. Il n'a pas le temps : chaque fiche doit dire en 20 secondes pourquoi appeler, qui, et quoi dire.

LE VENDEUR
${c.vendeur}

LE CLIENT IDÉAL
${c.icp}

Aujourd'hui : ${aujourdhui}.

LA CHANCE = probabilité qu'un appel cette semaine mène à un rendez-vous. Elle n'est PAS la note du signal. Pèse :
1. Besoin direct : cherche un prestataire / se plaint du sien > crée ou recrute un poste maintenance multi-sites (la personne aura besoin de prestataires) > nouveau décideur nommé > ouvertures de sites > simple réaction.
2. Taille et forme : réseau de nombreux petits sites (magasins, agences, crèches, restaurants) = idéal ; gros groupe avec services techniques internes ou contrats nationaux déjà en place = plus dur ; site unique ou usine = faible.
3. Une personne nommée et joignable monte la chance ; « intitulé à chercher » la baisse.
4. Fraîcheur : moins de 15 jours = mieux ; plus de 30 jours = baisse.
5. Plusieurs signaux concordants sur la même entreprise montent la chance.
6. Toujours « faible » : siège ou bureaux seuls (pas de réseau de sites), usine, brasserie, entrepôt unique, site unique, établissement de santé ou hôpital, acheteur public.
7. Un décideur maintenance/travaux qui vient de prendre son poste dans un réseau de sites ouverts au public (magasins, laboratoires, agences, crèches, restaurants) vaut au moins une chance moyenne haute : il fait le tour de ses prestataires dans ses premiers mois.
haute = appeler en premier ; moyenne = vaut un appel ; faible = à garder en veille.

LA PHRASE D'OUVERTURE : le vendeur n'est pas recruteur. Ne dis jamais « je vous appelle au sujet de votre recrutement » ni « suite à votre offre d'emploi ». Parle des sites et du quotidien : « vous structurez la maintenance de vos boutiques en ce moment », « vous venez de prendre la responsabilité des travaux sur X sites, félicitations ». Puis une question ouverte sur leur organisation actuelle.

Règles : ne te fie qu'aux signaux. N'invente ni nom, ni chiffre, ni client. Une annonce passée par un cabinet pour un client anonyme : dis-le dans a_verifier.`,
      },
      { role: "user", content: formater(k) },
    ],
    "fiche_appel",
    SCHEMA,
  );
  return { ...f, chance_score: Math.max(0, Math.min(100, Math.round(f.chance_score))) };
}

const RANG: Record<Chance, number> = { haute: 0, moyenne: 1, faible: 2 };
const trier = (l: { fiche: Fiche }[]) => l.sort((a, b) => RANG[a.fiche.chance] - RANG[b.fiche.chance] || b.fiche.chance_score - a.fiche.chance_score);

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "date inconnue");

function html(c: Campagne, l: { compte: Compte; fiche: Fiche }[], titre: string, sousTitre: string) {
  const carte = ({ compte: k, fiche: f }: { compte: Compte; fiche: Fiche }, i: number) => {
    const s = k.signaux[0];
    const preuves = k.signaux
      .slice(0, 3)
      .map((x) => `<li>${esc(x.plateforme)} · ${jour(x.date)}${x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">voir</a>` : ""}${x.personne?.url ? ` · <a href="${esc(x.personne.url)}" target="_blank" rel="noopener">profil de ${esc(x.personne.nom)}</a>` : ""}</li>`)
      .join("");
    return `
  <article class="fiche ${f.chance}">
    <header>
      <span class="rang">${i + 1}</span>
      <div><h2>${esc(f.entreprise || k.entreprise)}</h2><p class="reseau">${esc(f.reseau)}</p></div>
      <span class="chance" title="${esc(f.raison_chance)}">Chance ${f.chance}</span>
    </header>
    <dl>
      <dt>Ce qui s'est passé</dt><dd>${esc(f.declencheur)}</dd>
      <dt>Pourquoi maintenant</dt><dd>${esc(f.pourquoi_maintenant)}</dd>
      <dt>Qui appeler</dt><dd>${esc(f.qui_appeler)}<span class="doux"> — ${esc(f.comment_le_trouver)}</span></dd>
      <dt>Phrase d'ouverture</dt><dd class="phrase">« ${esc(f.phrase_ouverture.replace(/^«\s*|\s*»$/g, ""))} »</dd>
      <dt>À vérifier</dt><dd>${esc(f.a_verifier)}</dd>
      <dt>Pourquoi cette chance</dt><dd class="doux">${esc(f.raison_chance)} <span class="note">Note du signal : ${s.notation.note} ${s.notation.score}/100</span></dd>
    </dl>
    <ul class="preuves">${preuves}</ul>
  </article>`;
  };

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titre)}</title>
<style>
:root{--fond:#f3f4f1;--carte:#fff;--texte:#17191c;--doux:#5c626a;--ligne:#dfe2dc;--haute:#0f7a4a;--moyenne:#a3620a;--faible:#6b7280;--lien:#1d4fd8;--phrase:#eef5f0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fond:#121417;--carte:#1b1e22;--texte:#e9ebee;--doux:#9aa1a9;--ligne:#2b2f35;--haute:#4cc38a;--moyenne:#e3a548;--faible:#9aa1a9;--lien:#8fb0ff;--phrase:#1d2a23}}
:root[data-theme="dark"]{--fond:#121417;--carte:#1b1e22;--texte:#e9ebee;--doux:#9aa1a9;--ligne:#2b2f35;--haute:#4cc38a;--moyenne:#e3a548;--faible:#9aa1a9;--lien:#8fb0ff;--phrase:#1d2a23}
body{margin:0;background:var(--fond);color:var(--texte);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 64px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:26px;text-wrap:balance}.intro{margin:0;color:var(--doux);max-width:68ch}
.legende{display:grid;gap:6px;padding:12px 14px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte);font-size:14px}
.fiche{background:var(--carte);border:1px solid var(--ligne);border-left:5px solid var(--faible);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;break-inside:avoid}
.fiche.haute{border-left-color:var(--haute)}.fiche.moyenne{border-left-color:var(--moyenne)}
.fiche header{display:flex;gap:12px;align-items:flex-start}.fiche header>div{flex:1}
.rang{font-weight:700;color:var(--doux);font-variant-numeric:tabular-nums;min-width:1.6em}
h2{margin:0;font-size:19px}.reseau{margin:2px 0 0;color:var(--doux);font-size:14px}
.chance{white-space:nowrap;font-weight:700;font-size:13px;padding:3px 10px;border-radius:999px;color:#fff;background:var(--faible)}
.haute .chance{background:var(--haute)}.moyenne .chance{background:var(--moyenne)}
dl{margin:0;display:grid;grid-template-columns:150px 1fr;gap:8px 14px}dt{font-weight:600;font-size:13px;color:var(--doux);padding-top:2px}dd{margin:0}
.phrase{background:var(--phrase);padding:8px 10px;border-radius:8px}.doux{color:var(--doux)}.note{display:inline-block;margin-left:6px;font-size:12px}
.preuves{margin:0;padding-left:18px;font-size:13px;color:var(--doux)}a{color:var(--lien)}
@media (max-width:600px){dl{grid-template-columns:1fr}dt{padding-top:6px}}
@media print{body{background:#fff}.fiche{border-color:#ccc}}
</style></head><body><main>
<h1>${esc(titre)}</h1>
<p class="intro">${esc(sousTitre)}</p>
<div class="legende">
  <span><b>Chance</b> = probabilité qu'un appel cette semaine mène à un rendez-vous. Elle pèse le besoin (cherche un prestataire, recrute un poste maintenance multi-sites…), la taille du réseau, une personne nommée, la fraîcheur.</span>
  <span><b>Note du signal</b> (A/B et /100) = force du fait public lui-même. Un signal fort chez un grand groupe déjà équipé peut avoir une chance moyenne : c'est normal.</span>
</div>
${l.map(carte).join("")}
</main></body></html>`;
}

// --- exécution ---
const [id = "agence", jours = "30", nombre = "10"] = process.argv.slice(2);
const c = campagnes[id];
if (!c) throw new Error(`Campagne inconnue : ${id}`);
ouvrirBudget(c.id, c.budget);
const limite = Date.now() - Number(jours) * 86_400_000;
const liste = comptes(lireHistorique(id).filter((s) => new Date(s.note_le).getTime() >= limite)).filter((k) => k.entreprise !== "(entreprise à identifier)");

// Cache : une fiche n'est refaite que si de nouveaux signaux arrivent sur l'entreprise.
const fCache = `data/${id}/fiches.json`;
const cache: Record<string, { signaux: string; fiche: Fiche }> = existsSync(fCache) ? JSON.parse(readFileSync(fCache, "utf8")) : {};
const aujourdhui = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
let appels = 0;
const resultats = await enParallele(liste, 6, async (k) => {
  const cle = cleEntreprise(k.entreprise) || k.entreprise;
  const sig = k.signaux.map((s) => s.id).sort().join("|");
  if (cache[cle]?.signaux !== sig) {
    cache[cle] = { signaux: sig, fiche: await ficher(c, k, aujourdhui) };
    appels++;
  }
  return { compte: k, fiche: cache[cle].fiche };
});
writeFileSync(fCache, JSON.stringify(cache, null, 1));
trier(resultats);

mkdirSync("out", { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const n = { haute: 0, moyenne: 0, faible: 0 };
for (const r of resultats) n[r.fiche.chance]++;
writeFileSync(
  `out/${id}-fiches-${date}.html`,
  html(c, resultats, `Fiches d'appel · ${c.nom}`, `${resultats.length} entreprises sur ${jours} jours, triées par chance : ${n.haute} hautes, ${n.moyenne} moyennes, ${n.faible} faibles.`),
);
// Sélection relue à la main (data/<campagne>/selection.txt) : une ligne par entreprise, dans l'ordre voulu,
// « Nom » ou « Nom | chance | raison » pour corriger la chance donnée par l'IA. Sinon les N premières par chance.
const fSel = `data/${id}/selection.txt`;
const choix = existsSync(fSel)
  ? readFileSync(fSel, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
  : [];
const top = choix.length
  ? choix.map((ligne) => {
      const [nom, chance, raison] = ligne.split("|").map((x) => x.trim());
      const r = resultats.find((x) => cleEntreprise(x.compte.entreprise) === cleEntreprise(nom));
      if (!r) throw new Error(`selection.txt : « ${nom} » introuvable parmi les fiches`);
      if (chance && !(chance in RANG)) throw new Error(`selection.txt : chance « ${chance} » inconnue (haute, moyenne, faible)`);
      return chance ? { ...r, fiche: { ...r.fiche, chance: chance as Chance, raison_chance: raison || r.fiche.raison_chance } } : r;
    })
  : resultats.slice(0, Number(nombre));
writeFileSync(
  `out/${id}-top${nombre}-${date}.html`,
  html(c, top, `${top.length} entreprises à appeler cette semaine`, `Repérées dans des sources publiques (offres d'emploi, LinkedIn, presse) sur les ${jours} derniers jours. Chaque fiche dit ce qui s'est passé, pourquoi c'est le moment, qui appeler et quoi dire.`),
);
console.log(`${resultats.length} fiches (${appels} nouvelles, ${resultats.length - appels} en cache) · haute ${n.haute}, moyenne ${n.moyenne}, faible ${n.faible}`);
console.log(`out/${id}-fiches-${date}.html\nout/${id}-top${nombre}-${date}.html`);
console.log(bilan());

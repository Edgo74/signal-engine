import { mkdirSync, writeFileSync } from "node:fs";
import { resumeFiche } from "./entreprises.js";
import { cleEntreprise } from "./lib/outils.js";
import { DELAIS, type Campagne, type SignalNote } from "./types.js";

// Regroupe les signaux A/B par entreprise cible : plusieurs signaux sur un même compte = priorité.
// Les signaux A/B des passages précédents (historique) comptent aussi : une entreprise qui revient a un besoin actif.

export type Compte = {
  entreprise: string;
  secteur: string;
  sites: string;
  meilleure: "A" | "B";
  score: number;
  signaux: SignalNote[];
  avant: SignalNote[]; // signaux A/B des passages précédents sur la même entreprise (90 jours)
  cible: boolean; // dans la liste des comptes cibles du client
  chaudJusquau: Date | null; // date limite du signal le plus chaud
};

const JOUR = 86_400_000;
export const expire = (s: SignalNote) => {
  const t = new Date(s.date ?? s.note_le).getTime();
  return Number.isNaN(t) ? null : new Date(t + (DELAIS[s.notation.type_signal] ?? 14 * 24) * 3_600_000);
};

export function comptes(signaux: SignalNote[], historique: SignalNote[] = [], cibles: string[] = []): Compte[] {
  const cle = (s: SignalNote) => {
    const nom = s.notation.entreprise_cible || s.entreprise || "";
    return cleEntreprise(nom) || nom;
  };
  const ids = new Set(signaux.map((s) => s.id));
  const anciens = new Map<string, SignalNote[]>();
  for (const s of historique) {
    if (s.notation.note === "X" || ids.has(s.id) || Date.now() - new Date(s.note_le).getTime() > 90 * JOUR) continue;
    const k = cle(s);
    if (k) anciens.set(k, [...(anciens.get(k) ?? []), s]);
  }
  const clesCibles = new Set(cibles.map((x) => cleEntreprise(x)).filter(Boolean));

  const map = new Map<string, Compte>();
  for (const s of signaux) {
    const n = s.notation;
    if (n.note === "X") continue;
    const nom = n.entreprise_cible || s.entreprise || "(entreprise à identifier)";
    const k = cle(s) || nom;
    const c = map.get(k) ?? {
      entreprise: nom,
      secteur: n.secteur,
      sites: n.sites_estimes,
      meilleure: n.note,
      score: 0,
      signaux: [],
      avant: anciens.get(k) ?? [],
      cible: clesCibles.has(k),
      chaudJusquau: null,
    };
    c.signaux.push(s);
    if (n.note === "A") c.meilleure = "A";
    if (c.sites === "inconnu" && n.sites_estimes !== "inconnu") c.sites = n.sites_estimes;
    map.set(k, c);
  }
  const maintenant = Date.now();
  for (const c of map.values()) {
    c.signaux.sort((a, b) => (a.notation.note === b.notation.note ? b.notation.score - a.notation.score : a.notation.note === "A" ? -1 : 1));
    const fins = c.signaux.map(expire).filter((d): d is Date => d !== null);
    c.chaudJusquau = fins.length ? new Date(Math.max(...fins.map((d) => d.getTime()))) : null;
    // Meilleur signal + bonus par signal supplémentaire (ce passage ou les précédents), plafonné ; un signal refroidi perd 20.
    const autres = c.signaux.length - 1 + c.avant.length;
    c.score = Math.min(100, c.signaux[0].notation.score + 5 * Math.min(autres, 4));
    if (c.chaudJusquau && c.chaudJusquau.getTime() < maintenant) c.score = Math.max(0, c.score - 20);
  }
  // Comptes cibles d'abord, puis A avant B, puis score.
  return [...map.values()].sort((a, b) =>
    a.cible !== b.cible ? (a.cible ? -1 : 1) : a.meilleure !== b.meilleure ? (a.meilleure === "A" ? -1 : 1) : b.score - a.score,
  );
}

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const jour = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "date ?");
const TYPES: Record<string, string> = {
  demande_recommandation: "Demande une recommandation",
  recherche_prestataire: "Cherche un prestataire",
  insatisfaction_prestataire: "Mécontent de sa solution actuelle",
  douleur_exprimee: "Exprime le problème",
  recrutement: "Recrute pour ce besoin",
  nouveau_decideur: "Nouveau décideur",
  croissance: "Croissance (levée, ouverture, lancement)",
  appel_offres: "Appel d'offres",
  engagement_categorie: "Suit le sujet",
  autre: "Autre",
  recrutement_maintenance: "Recrute en maintenance",
  ouverture_sites: "Ouvre des sites",
  decideur_actif: "Décideur actif",
};
const limite = (d: Date | null) => {
  if (!d) return "";
  const h = (d.getTime() - Date.now()) / 3_600_000;
  const le = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  if (h < 0) return `<span class="froid">refroidi depuis le ${le}</span>`;
  return `<span class="chaud">à contacter ${h < 48 ? `sous ${Math.max(1, Math.round(h))} h` : `avant le ${le}`}</span>`;
};

export function ecrireRapport(
  c: Campagne,
  tous: SignalNote[],
  stats: Record<string, number>,
  erreurs: string[],
  historique: SignalNote[] = [],
): { html: string; csv: string } {
  mkdirSync("out", { recursive: true });
  const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const liste = comptes(tous, historique, c.comptesCibles);
  const nA = tous.filter((s) => s.notation.note === "A").length;
  const nB = tous.filter((s) => s.notation.note === "B").length;

  const carte = (k: Compte) => `
  <article class="compte ${k.meilleure}">
    <header>
      <span class="note">${k.meilleure}</span>
      <h2>${esc(k.entreprise)}</h2>
      ${k.cible ? `<span class="tag">compte cible</span>` : ""}
      <span class="meta">${esc(k.secteur)} · ${esc(k.sites)} · ${k.signaux.length} signal${k.signaux.length > 1 ? "s" : ""} · score ${k.score}</span>
      ${limite(k.chaudJusquau)}
    </header>
    ${
      k.avant.length
        ? `<p class="revient">Revient : ${k.avant.length} autre(s) signal(s) les semaines précédentes (${k.avant
            .slice(0, 3)
            .map((s) => esc(`${TYPES[s.notation.type_signal] ?? s.notation.type_signal}, ${jour(s.date ?? s.note_le)}`))
            .join(" ; ")})</p>`
        : ""
    }
    ${k.signaux
      .map(
        (s) => `
    <section class="signal">
      <div class="ligne1"><span class="type">${TYPES[s.notation.type_signal] ?? s.notation.type_signal}</span><span>${esc(s.plateforme)} · ${jour(s.date)} · ${s.notation.note}${s.notation.score}</span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Voir la source</a>` : ""}</div>
      <p class="pourquoi">${esc(s.notation.pourquoi)}${s.notation.urgence ? ` <b>Délai : « ${esc(s.notation.urgence)} »</b>` : ""}</p>
      ${s.contexte ? `<p class="contexte">${esc(s.contexte)}</p>` : ""}
      <p class="extrait">${esc(s.titre)}</p>
      ${s.fiche ? `<p class="fiche">${s.fiche.source === "registre" ? "Registre" : "LinkedIn"} : ${esc(resumeFiche(s.fiche))}</p>` : ""}
      <p class="qui"><b>Qui contacter :</b> ${esc(s.notation.qui_contacter)}${s.personne?.url ? ` · <a href="${esc(s.personne.url)}" target="_blank" rel="noopener">profil</a>` : ""}</p>
      ${s.notation.accroche ? `<p class="accroche">« ${esc(s.notation.accroche)} »</p>` : ""}
      ${s.notation.message ? `<details><summary>Message proposé</summary><p class="message">${esc(s.notation.message)}</p></details>` : ""}
      ${s.notation.commentaire_public ? `<details><summary>Commentaire à publier sous le post</summary><p class="message">${esc(s.notation.commentaire_public)}</p></details>` : ""}
    </section>`,
      )
      .join("")}
  </article>`;

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signaux · ${esc(c.nom)}</title>
<style>
:root{--fond:#f4f5f2;--carte:#fff;--texte:#16191d;--doux:#5d636b;--ligne:#e2e4df;--a:#0f7a4a;--b:#a3620a;--lien:#1d4fd8}
@media (prefers-color-scheme:dark){:root{--fond:#121417;--carte:#1b1e22;--texte:#e9ebee;--doux:#9aa1a9;--ligne:#2b2f35;--a:#4cc38a;--b:#e3a548;--lien:#8fb0ff}}
body{margin:0;background:var(--fond);color:var(--texte);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:24px}.resume{color:var(--doux);margin:0}
.compte{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}
.compte header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.compte h2{margin:0;font-size:18px}.meta{color:var(--doux);font-size:13px}
.note{font-weight:700;font-size:13px;padding:2px 8px;border-radius:6px;color:#fff;background:var(--b)}.A .note{background:var(--a)}
.signal{border-top:1px solid var(--ligne);padding-top:10px;display:flex;flex-direction:column;gap:6px}
.ligne1{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--doux)}.type{font-weight:600;color:var(--texte)}
p{margin:0}.extrait,.contexte{color:var(--doux);font-size:13px}.message{white-space:pre-wrap;padding:10px;border-radius:8px;background:var(--fond);margin-top:6px}
a{color:var(--lien)}summary{cursor:pointer;color:var(--lien);font-size:14px}
.erreurs{font-size:13px;color:var(--b)}
.chaud{font-size:12px;font-weight:600;color:var(--a)}.froid{font-size:12px;color:var(--doux)}
.tag{font-size:12px;font-weight:600;padding:1px 7px;border-radius:6px;border:1px solid var(--lien);color:var(--lien)}
.revient{font-size:13px}.fiche{font-size:13px;color:var(--doux)}.accroche{font-style:italic}
</style></head><body><main>
<h1>${esc(c.nom)}</h1>
<p class="resume">${new Date().toLocaleString("fr-FR")} · ${liste.length} entreprises · ${nA} signaux A, ${nB} B · collectés : ${Object.entries(stats)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}</p>
${erreurs.length ? `<p class="erreurs">${erreurs.map(esc).join("<br>")}</p>` : ""}
${liste.map(carte).join("") || "<p>Aucun signal A ou B sur ce passage.</p>"}
</main></body></html>`;

  const cellule = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  // statut : à remplir par le client (contacté / répondu / rdv / pas pertinent) pour mesurer quels signaux rapportent.
  const entetes = ["note", "score", "entreprise", "secteur", "taille", "siren", "fiche_entreprise", "type", "a_contacter_avant", "urgence", "pourquoi", "qui_contacter", "personne", "profil", "plateforme", "date", "lien", "accroche", "message", "commentaire_public", "statut"];
  const lignes = tous
    .filter((s) => s.notation.note !== "X")
    .sort((a, b) => (a.notation.note === b.notation.note ? b.notation.score - a.notation.score : a.notation.note === "A" ? -1 : 1))
    .map((s) =>
      [
        s.notation.note,
        s.notation.score,
        s.notation.entreprise_cible,
        s.notation.secteur,
        s.notation.sites_estimes,
        s.fiche?.siren,
        s.fiche && resumeFiche(s.fiche),
        TYPES[s.notation.type_signal],
        expire(s)?.toISOString().slice(0, 10),
        s.notation.urgence,
        s.notation.pourquoi,
        s.notation.qui_contacter,
        s.personne?.nom,
        s.personne?.url,
        s.plateforme,
        s.date?.slice(0, 10),
        s.url,
        s.notation.accroche,
        s.notation.message,
        s.notation.commentaire_public,
        "",
      ]
        .map(cellule)
        .join(";"),
    );

  const base = `out/${c.id}-${date}`;
  writeFileSync(`${base}.html`, html);
  writeFileSync(`${base}.csv`, "﻿" + [entetes.join(";"), ...lignes].join("\n")); // BOM : Excel lit les accents
  return { html: `${base}.html`, csv: `${base}.csv` };
}

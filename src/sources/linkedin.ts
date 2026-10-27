import { lancerActeur, PRIX } from "../lib/apify.js";
import { isoOuNull, propre } from "../lib/outils.js";
import type { OptionsScan, Personne, Signal, Source } from "../types.js";

// Lecture LinkedIn via des acteurs Apify « sans cookies » (harvestapi) : aucun compte LinkedIn n'est utilisé.
// Prix (octobre 2026) : 0,002 $ par post et par commentaire. On ne paie que ce qui est nouveau :
// chaque passage repart de la date du passage précédent (o.depuis).

type Brut = Record<string, any>;

const periode = (jours: number) => (jours <= 1 ? "24h" : jours <= 7 ? "week" : "month");
const heures = (o: OptionsScan) => Math.max(1, (Date.now() - o.depuis.getTime()) / 3_600_000);
// Nombre de posts demandés, proportionnel à la fenêtre : `parSemaine` posts pour 7 jours, au moins `min`.
const selonFenetre = (parSemaine: number, o: OptionsScan, min: number) => Math.min(parSemaine, Math.max(min, Math.ceil((parSemaine * heures(o)) / 168)));

function auteur(p: Brut): Personne | null {
  const a = p.author ?? p.actor;
  if (!a?.name) return null;
  return { nom: a.name, poste: a.info ?? a.position ?? a.headline ?? null, url: a.linkedinUrl ?? a.url ?? null };
}

const datePost = (p: Brut) => isoOuNull(p.postedAt?.timestamp ?? p.postedAt?.date ?? p.postedAt ?? p.createdAt);
const urlPost = (p: Brut) => p.linkedinUrl ?? p.url ?? p.postUrl ?? null;

// « Responsable travaux chez Kiabi » → « Kiabi ». L'IA corrige ensuite si besoin.
export function entrepriseDuTitre(titre: string | null): string | null {
  if (!titre) return null;
  const m = titre.match(/(?:\bchez|\bat|@)\s+([^|,•·–—]+)/i);
  return m ? m[1].trim().slice(0, 80) : null;
}

export const linkedinPosts: Source = {
  id: "linkedin_posts",
  nom: "LinkedIn · posts par mots-clés",
  async collecter(c, o) {
    // Une exécution par filtre « auteur » (le filtre est global à l'exécution).
    const groupes = new Map<string, string[]>();
    for (const r of c.linkedin.requetes) groupes.set(r.auteur ?? "", [...(groupes.get(r.auteur ?? "") ?? []), r.q]);
    const liste = o.test ? [...groupes].slice(0, 1) : [...groupes];
    const parRequete = o.test ? 5 : selonFenetre(c.linkedin.postsParRequete, o, 10);

    const lots = await Promise.allSettled(
      liste.map(async ([auteurMots, toutes]) => {
        const requetes = o.test ? toutes.slice(0, 2) : toutes;
        const posts = await lancerActeur<Brut>(
          "harvestapi/linkedin-post-search",
          {
            searchQueries: requetes,
            maxPosts: parRequete,
            postedLimitDate: o.depuis.toISOString(),
            sortBy: "date",
            ...(auteurMots ? { authorKeywords: auteurMots } : {}),
          },
          { estimation: requetes.length * parRequete * PRIX.linkedinPost },
        );
        return posts
          .filter((p) => (p.type ?? "post") === "post" && (p.content || p.text))
          .map((p): Signal => {
            const pers = auteur(p);
            const auteurEntreprise = p.author?.type === "company" ? p.author.name : null;
            return {
              id: `linkedin_posts:${p.id ?? urlPost(p)}`,
              source: "linkedin_posts",
              plateforme: "LinkedIn",
              type: "post",
              date: datePost(p),
              url: urlPost(p),
              titre: propre(p.content ?? p.text).slice(0, 120),
              texte: propre(p.content ?? p.text).slice(0, 3000),
              entreprise: auteurEntreprise ?? entrepriseDuTitre(pers?.poste ?? null),
              personne: pers,
              requete: [texteRequete(p.query ?? p.searchQuery) ?? requetes.join(" | "), auteurMots && `auteur : ${auteurMots}`].filter(Boolean).join(" · "),
            };
          });
      }),
    );
    for (const l of lots) if (l.status === "rejected") console.warn(`  ⚠ LinkedIn posts : ${l.reason}`);
    return lots.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
  },
};

export const linkedinEngagement: Source = {
  id: "linkedin_engagement",
  nom: "LinkedIn · qui réagit aux comptes surveillés",
  async collecter(c, o) {
    if (!c.linkedin.comptesSurveilles.length) return [];
    const comptes = o.test ? c.linkedin.comptesSurveilles.slice(0, 1) : c.linkedin.comptesSurveilles;
    const parCompte = o.test ? 2 : selonFenetre(c.linkedin.postsParCompte, o, 2);
    const commentaires = o.test ? 10 : c.linkedin.commentairesParPost;
    const reactions = o.test ? 20 : c.linkedin.reactionsParPost;
    const posts = await lancerActeur<Brut>(
      "harvestapi/linkedin-company-posts",
      {
        targetUrls: comptes.map((x) => x.url),
        maxPosts: parCompte,
        postedLimit: periode(o.jours),
        includeReposts: false,
        scrapeReactions: c.linkedin.reactionsParPost > 0,
        maxReactions: reactions,
        postNestedReactions: c.linkedin.reactionsParPost > 0,
        scrapeComments: true,
        maxComments: commentaires,
        postNestedComments: true,
      },
      // Estimation probable : un post d'entreprise reçoit rarement le maximum de commentaires (on compte un tiers).
      {
        estimation:
          comptes.length * parCompte * (PRIX.linkedinPost + (commentaires / 3) * PRIX.linkedinCommentaire + (c.linkedin.reactionsParPost > 0 ? (reactions / 3) * PRIX.linkedinReaction : 0)),
      },
    );

    const signaux: Signal[] = [];
    for (const p of posts) {
      if ((p.type ?? "post") !== "post") continue;
      const compte = p.author?.name ?? "compte surveillé";
      const extrait = propre(p.content ?? p.text).slice(0, 300);
      const gens: { brut: Brut; type: "reaction" | "commentaire"; texte: string }[] = [
        ...((p.reactions ?? []) as Brut[]).map((r) => ({ brut: r, type: "reaction" as const, texte: String(r.reactionType ?? "like") })),
        ...((p.comments ?? []) as Brut[]).map((r) => ({ brut: r, type: "commentaire" as const, texte: propre(r.commentary ?? r.text ?? "") })),
      ];
      for (const g of gens) {
        const pers = auteur(g.brut);
        if (!pers?.poste || !c.linkedin.titresEngagement.test(pers.poste) || c.exclure.test(pers.poste)) continue;
        signaux.push({
          id: `linkedin_engagement:${p.id ?? urlPost(p)}:${pers.url ?? pers.nom}`,
          source: "linkedin_engagement",
          plateforme: "LinkedIn",
          type: g.type,
          date: isoOuNull(g.brut.createdAt) ?? datePost(p),
          url: g.brut.linkedinUrl ?? urlPost(p),
          titre: `${pers.nom} — ${pers.poste}`.slice(0, 160),
          texte: g.type === "commentaire" ? g.texte.slice(0, 1500) : `Réaction « ${g.texte} »`,
          entreprise: entrepriseDuTitre(pers.poste),
          personne: pers,
          requete: compte,
          contexte: `${g.type === "commentaire" ? "A commenté" : "A réagi à"} un post de ${compte} : « ${extrait} »`,
        });
      }
    }
    return signaux;
  },
};

// Commentaires de plainte : sous des posts qui parlent du métier du vendeur, un décideur dit que son
// prestataire ne va pas, ou cherche quelqu'un. En deux temps pour ne payer que les commentaires utiles :
//   1. on cherche les posts récents du sujet (sans leurs commentaires) ;
//   2. on lit les commentaires récents des quelques posts les plus commentés seulement.
export const linkedinPlaintes: Source = {
  id: "linkedin_plaintes",
  nom: "LinkedIn · commentaires de plainte",
  async collecter(c, o) {
    const pl = c.linkedin.plaintes;
    if (!pl.requetes.length) return [];
    const requetes = o.test ? pl.requetes.slice(0, 1) : pl.requetes;
    const parRequete = o.test ? 3 : pl.postsParRequete;

    // Un post reçoit l'essentiel de ses commentaires dans la semaine : on cherche les posts de la semaine,
    // puis on ne lit que les commentaires postés depuis le dernier passage.
    const posts = await lancerActeur<Brut>(
      "harvestapi/linkedin-post-search",
      { searchQueries: requetes, maxPosts: parRequete, postedLimit: "week", sortBy: "relevance" },
      { estimation: requetes.length * parRequete * PRIX.linkedinPost },
    );
    const retenus = [...new Map(posts.filter((p) => p.id && urlPost(p)).map((p) => [String(p.id), p])).values()]
      .filter((p) => (p.engagement?.comments ?? 0) >= 2)
      .filter((p) => !c.exclure.test(`${auteur(p)?.nom ?? ""} ${auteur(p)?.poste ?? ""}`))
      .sort((a, b) => (b.engagement?.comments ?? 0) - (a.engagement?.comments ?? 0))
      .slice(0, o.test ? 1 : pl.postsCommentes);
    if (!retenus.length) return [];

    const parPost = o.test ? 10 : pl.commentairesParPost;
    const commentaires = await lancerActeur<Brut>(
      "harvestapi/linkedin-post-comments",
      { posts: retenus.map(urlPost), maxItems: parPost, postedLimit: periode(o.jours), scrapeReplies: false },
      { estimation: retenus.length * parPost * PRIX.linkedinCommentaire },
    );
    const parId = new Map(retenus.map((p) => [String(p.id), p]));

    const signaux: Signal[] = [];
    for (const com of commentaires) {
      const p = parId.get(String(com.postId)) ?? retenus.find((x) => String(com.linkedinUrl ?? "").includes(String(x.id)));
      const pers = auteur(com);
      const texte = propre(com.commentary ?? com.text ?? "");
      if (!pers?.poste || !texte) continue;
      if (!c.linkedin.titresEngagement.test(pers.poste) || c.exclure.test(pers.poste)) continue;
      if (!pl.texte.test(texte)) continue;
      const auteurPost = p ? auteur(p) : null;
      const extrait = p ? propre(p.content ?? p.text).slice(0, 400) : "";
      signaux.push({
        id: `linkedin_plaintes:${com.id ?? com.linkedinUrl ?? `${com.postId}:${pers.nom}`}`,
        source: "linkedin_plaintes",
        plateforme: "LinkedIn (commentaire)",
        type: "commentaire",
        date: isoOuNull(com.createdAt) ?? (p ? datePost(p) : null),
        url: com.linkedinUrl ?? (p ? urlPost(p) : null),
        titre: `${pers.nom} — ${pers.poste}`.slice(0, 160),
        texte: texte.slice(0, 1500),
        entreprise: entrepriseDuTitre(pers.poste),
        personne: pers,
        requete: texteRequete(p?.query ?? p?.searchQuery) ?? requetes.join(" | "),
        contexte: `A commenté le post de ${auteurPost?.nom ?? "?"}${auteurPost?.poste ? ` (${auteurPost.poste.slice(0, 80)})` : ""} : « ${extrait} »`,
      });
    }
    return signaux;
  },
};

// L'acteur renvoie parfois la requête sous forme d'objet ({ search: "…", … }) : on garde le texte.
function texteRequete(q: unknown): string | undefined {
  if (typeof q === "string") return q;
  if (q && typeof q === "object") {
    const o = q as Record<string, unknown>;
    const t = o.search ?? o.searchQuery ?? o.query ?? o.keywords;
    if (typeof t === "string") return t;
    return Object.values(o).find((v): v is string => typeof v === "string");
  }
  return undefined;
}

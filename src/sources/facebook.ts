import { lancerActeur, PRIX } from "../lib/apify.js";
import { isoOuNull, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Groupes Facebook PUBLICS via Apify (apify/facebook-groups-scraper, ~2,60 $ / 1 000 posts).
// Les groupes privés demandent une connexion : on ne les lit pas.

export const facebookGroupes: Source = {
  id: "facebook_groupes",
  nom: "Facebook · groupes publics",
  async collecter(c, o) {
    const groupes = o.test ? c.facebook.groupes.slice(0, 1) : c.facebook.groupes;
    if (!groupes.length) {
      console.warn("  ⚠ Facebook : aucun groupe dans la campagne (npm run groupes -- <campagne> pour en trouver)");
      return [];
    }
    const parGroupe = o.test ? 10 : c.facebook.postsParGroupe;
    const posts = await lancerActeur<any>(
      "apify/facebook-groups-scraper",
      {
        startUrls: groupes.map((g) => ({ url: g.url })),
        resultsLimit: parGroupe,
        viewOption: "CHRONOLOGICAL",
        onlyPostsNewerThan: `${o.jours} days`,
      },
      { estimation: groupes.length * parGroupe * PRIX.facebookPost },
    );

    return posts
      .map((p) => ({ p, texte: propre(p.text ?? p.postText ?? p.message ?? "") }))
      .filter(({ texte }) => texte && c.facebook.filtre.test(texte))
      .map(({ p, texte }): Signal => {
        const groupe = p.groupTitle ?? groupes.find((g) => p.facebookUrl?.startsWith(g.url) || p.url?.includes(g.url))?.nom ?? "groupe";
        const commentaires = ((p.topComments ?? p.comments ?? []) as any[])
          .slice(0, 5)
          .map((x) => `- ${propre(x.text ?? x.commentText ?? "")}`)
          .filter((x) => x.length > 3)
          .join("\n");
        return {
          id: `facebook_groupes:${p.postId ?? p.id ?? p.url}`,
          source: "facebook_groupes",
          plateforme: `Facebook · ${groupe}`,
          type: "post_groupe",
          date: isoOuNull(p.time ?? p.date ?? p.timestamp),
          url: p.url ?? p.facebookUrl ?? null,
          titre: texte.slice(0, 120),
          texte: [texte.slice(0, 2500), commentaires && `Commentaires :\n${commentaires}`].filter(Boolean).join("\n\n"),
          entreprise: null,
          personne: p.user?.name ? { nom: p.user.name, poste: null, url: p.user.profileUrl ?? (p.user.id ? `https://www.facebook.com/${p.user.id}` : null) } : null,
          requete: groupe,
        };
      });
  },
};

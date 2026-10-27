import { lancerActeur, PRIX } from "../lib/apify.js";
import { isoOuNull, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Reddit, X et commentaires sous les posts de pages Facebook publiques, lus directement (plus via Google).
// Utiles surtout pour les logiciels et les clients anglophones ; inutiles pour un métier de terrain en France.
// Chaque source ne tourne que si la campagne la configure
// ET la met dans `sources`. Les recherches remontent beaucoup de bruit : un filtre de texte passe avant l'IA.

const depuisJour = (d: Date) => d.toISOString().slice(0, 10);

// Reddit : trudax/reddit-scraper-lite, 0,004 $ le post + 0,02 $ par Go de mémoire au démarrage (1 Go suffit).
// Une recherche Reddit est large (« CMMS recommend » → posts de métrologie, d'armes…) : `filtre` est indispensable.
// Pour viser une communauté, l'écrire dans la requête : `subreddit:SaaS "CRM"`.
export const reddit: Source = {
  id: "reddit",
  nom: "Reddit (recherche directe)",
  async collecter(c, o) {
    const r = c.reddit;
    if (!r?.requetes.length) return [];
    const requetes = o.test ? r.requetes.slice(0, 1) : r.requetes;
    const parRequete = o.test ? 3 : r.postsParRequete;
    const posts = await lancerActeur<any>(
      "trudax/reddit-scraper-lite",
      {
        searches: requetes,
        searchPosts: true,
        searchComments: false,
        searchCommunities: false,
        searchUsers: false,
        skipComments: true,
        sort: "new",
        postDateLimit: depuisJour(o.depuis),
        maxItems: requetes.length * parRequete,
        maxPostCount: parRequete,
        proxy: { useApifyProxy: true },
      },
      { estimation: requetes.length * parRequete * PRIX.redditPost + PRIX.redditDemarrage, memoire: 1024 },
    );
    return posts
      .filter((p) => p.dataType !== "comment" && p.dataType !== "community" && p.dataType !== "user")
      .map((p) => ({ p, titre: propre(p.title), texte: propre(p.body) }))
      .filter(({ p, titre, texte }) => r.filtre.test(`${titre} ${texte}`) && !c.exclure.test(`${p.username ?? ""} ${titre}`))
      .map(
        ({ p, titre, texte }): Signal => ({
          id: `reddit:${p.parsedId ?? p.id ?? p.url}`,
          source: "reddit",
          plateforme: `Reddit · ${p.communityName ?? "?"}`,
          type: "post",
          date: isoOuNull(p.createdAt),
          url: p.url ?? null,
          titre: titre.slice(0, 200),
          texte: texte.slice(0, 3000),
          entreprise: null,
          personne: p.username ? { nom: `u/${p.username}`, poste: null, url: `https://www.reddit.com/user/${p.username}` } : null,
          requete: p.searchQuery ?? requetes.join(" | "),
        }),
      );
  },
};

// X : kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest, 0,00025 $ le tweet, minimum facturé par appel
// (comblé par de faux tweets « mock_tweet », écartés ici). apidojo/tweet-scraper, plus connu, ne marche qu'en démo
// (10 tweets) sur le plan gratuit d'Apify. Une requête = un appel ; la syntaxe de recherche X marche
// (guillemets, OR, -mot, lang:fr).
export const x: Source = {
  id: "x",
  nom: "X (recherche directe)",
  async collecter(c, o) {
    const cfg = c.x;
    if (!cfg?.requetes.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const parRequete = o.test ? 20 : cfg.tweetsParRequete;
    const depuis = `${depuisJour(o.depuis)}_00:00:00_UTC`;
    const lots = await Promise.allSettled(
      requetes.map(async (q) => {
        const lignes = await lancerActeur<any>(
          "kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest",
          { twitterContent: q, maxItems: parRequete, queryType: "Latest", since: depuis, ...(cfg.langue ? { lang: cfg.langue } : {}) },
          { estimation: parRequete * PRIX.tweet + 0.005 },
        );
        return lignes.map((t) => ({ t, q }));
      }),
    );
    lots.forEach((l, i) => l.status === "rejected" && console.warn(`  ⚠ X « ${requetes[i]} » : ${l.reason instanceof Error ? l.reason.message : l.reason}`));
    if (lots.every((l) => l.status === "rejected")) throw new Error("toutes les recherches X ont échoué");
    return lots
      .flatMap((l) => (l.status === "fulfilled" ? l.value : []))
      .filter(({ t }) => t.type === "tweet" && t.id !== -1 && !t.retweeted_tweet)
      .map(({ t, q }) => ({ t, q, texte: propre(t.text) }))
      .filter(({ t, texte }) => cfg.filtre.test(texte) && !c.exclure.test(`${t.author?.name ?? ""} ${t.author?.description ?? ""}`))
      .map(
        ({ t, q, texte }): Signal => ({
          id: `x:${t.id}`,
          source: "x",
          plateforme: "X",
          type: "post",
          date: isoOuNull(t.createdAt),
          url: t.url ?? null,
          titre: texte.slice(0, 120),
          texte: texte.slice(0, 2000),
          entreprise: null,
          personne: t.author
            ? { nom: `${t.author.name ?? ""} (@${t.author.userName})`, poste: propre(t.author.description).slice(0, 200) || null, url: t.author.url ?? null }
            : null,
          requete: q,
          contexte: t.isReply ? `Réponse à un autre tweet (${t.inReplyToUsername ? `@${t.inReplyToUsername}` : "conversation"})` : undefined,
        }),
      );
  },
};

// Facebook, pages publiques (souvent celles des concurrents du client) : on lit leurs derniers posts
// (apify/facebook-posts-scraper, 0,005 $ le post), puis les commentaires des plus commentés
// (apify/facebook-comments-scraper, 0,0025 $ le commentaire). Pages publiques seulement, jamais de groupe privé.
export const facebookPages: Source = {
  id: "facebook_pages",
  nom: "Facebook · commentaires sous des pages publiques",
  async collecter(c, o) {
    const cfg = c.facebookPages;
    if (!cfg?.pages.length) return [];
    const pages = o.test ? cfg.pages.slice(0, 1) : cfg.pages;
    const parPage = o.test ? 3 : cfg.postsParPage;
    const posts = await lancerActeur<any>(
      "apify/facebook-posts-scraper",
      { startUrls: pages.map((p) => ({ url: p.url })), resultsLimit: parPage },
      { estimation: pages.length * parPage * PRIX.facebookPagePost + 0.001 },
    );
    // Le filtre de date d'Apify est facturé à part : on filtre ici.
    const recents = posts.filter((p) => p.url && (p.comments ?? 0) > 0 && (!p.time || new Date(p.time) >= o.depuis));
    const ouverts = recents.sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0)).slice(0, o.test ? 1 : cfg.postsCommentes);
    if (!ouverts.length) return [];
    const parPost = o.test ? 5 : cfg.commentairesParPost;
    const commentaires = await lancerActeur<any>(
      "apify/facebook-comments-scraper",
      { startUrls: ouverts.map((p) => ({ url: p.url })), resultsLimit: parPost, includeNestedComments: false },
      { estimation: ouverts.length * parPost * PRIX.facebookCommentaire + 0.001 },
    );
    const postDe = (u: string) => ouverts.find((p) => p.url === u || u?.startsWith(p.url));
    return commentaires
      .filter((m) => m.text && !m.error)
      .map((m) => ({ m, post: postDe(m.facebookUrl ?? m.inputUrl), texte: propre(m.text) }))
      .filter(({ m, post, texte }) => {
        const auteur = m.author?.name ?? "";
        if (post && auteur && auteur === (post.user?.name ?? post.pageName)) return false; // la page qui répond
        return cfg.filtre.test(texte) && !c.exclure.test(auteur);
      })
      .map(({ m, post, texte }): Signal => {
        const page = pages.find((p) => post?.inputUrl === p.url || post?.facebookUrl?.toLowerCase() === p.url.toLowerCase())?.nom ?? post?.pageName ?? "page";
        return {
          id: `facebook_pages:${m.commentId ?? m.id}`,
          source: "facebook_pages",
          plateforme: `Facebook · page ${page}`,
          type: "commentaire",
          date: isoOuNull(m.date),
          url: m.commentUrl ?? m.facebookUrl ?? null,
          titre: texte.slice(0, 120),
          texte: texte.slice(0, 2000),
          entreprise: null,
          personne: m.author?.name ? { nom: m.author.name, poste: null, url: m.author.id ? `https://www.facebook.com/${m.author.id}` : null } : null,
          requete: page,
          contexte: post ? `A commenté un post de la page ${page} : « ${propre(post.text).slice(0, 300)} »` : undefined,
        };
      });
  },
};

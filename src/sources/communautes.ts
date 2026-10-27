import { lancerActeur } from "../lib/apify.js";
import { fetchRobuste, isoOuNull, pause, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Communautés publiques anglophones, surtout techniques : Hacker News, Stack Exchange, GitHub, Bluesky (API gratuites),
// plus les avis App Store des applis concurrentes (Apify, 0,0001 $ l'avis). Utiles pour un logiciel, une appli ou un
// client qui vend en anglais ; presque rien à attendre pour un métier de terrain en France.
// Comme pour Reddit et X, `filtre` passe avant l'IA : ces recherches remontent beaucoup de discussions sans acheteur.

const UA = { "User-Agent": "signal-engine (veille de signaux publics)" };
const lireJson = async (url: string, headers: Record<string, string> = {}) => {
  const r = await fetchRobuste(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`${new URL(url).hostname} : ${r.status} ${(await r.text()).slice(0, 150)}`);
  return r.json() as Promise<any>;
};

// Hacker News, via l'API Algolia (gratuite, sans clé) : posts et commentaires, du plus récent au plus ancien.
export const hackerNews: Source = {
  id: "hacker_news",
  nom: "Hacker News",
  async collecter(c, o) {
    const cfg = c.hackerNews;
    if (!cfg?.requetes.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const depuis = Math.floor(o.depuis.getTime() / 1000);
    const lus = new Map<string, any>();
    for (const q of requetes) {
      const r = await lireJson(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=created_at_i>${depuis}&hitsPerPage=${o.test ? 10 : cfg.parRequete}`,
      );
      for (const h of r.hits ?? []) if (!lus.has(h.objectID)) lus.set(h.objectID, { ...h, q });
    }
    return [...lus.values()]
      .map((h) => ({ h, titre: propre(h.title ?? h.story_title), texte: propre(h.comment_text ?? h.story_text ?? h.title) }))
      .filter(({ h, titre, texte }) => cfg.filtre.test(`${h.title ?? ""} ${texte}`) && !c.exclure.test(`${h.author ?? ""} ${titre}`))
      .map(
        ({ h, titre, texte }): Signal => ({
          id: `hacker_news:${h.objectID}`,
          source: "hacker_news",
          plateforme: "Hacker News",
          type: h.comment_text ? "commentaire" : "post",
          date: isoOuNull(h.created_at),
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          titre: (h.comment_text ? texte : titre).slice(0, 200),
          texte: texte.slice(0, 3000),
          entreprise: null,
          personne: h.author ? { nom: h.author, poste: null, url: `https://news.ycombinator.com/user?id=${h.author}` } : null,
          requete: h.q,
          contexte: h.comment_text && titre ? `Commentaire dans la discussion « ${titre} »` : undefined,
        }),
      );
  },
};

// Stack Exchange (gratuit : 300 requêtes par jour sans clé, 10 000 avec STACKEXCHANGE_KEY, clé publique gratuite).
// Le site le plus utile pour un vendeur de logiciel : softwarerecs (« Software Recommendations »), où l'on demande un outil.
export const stackExchange: Source = {
  id: "stack_exchange",
  nom: "Stack Exchange (questions)",
  async collecter(c, o) {
    const cfg = c.stackExchange;
    if (!cfg?.requetes.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const sites = o.test ? cfg.sites.slice(0, 1) : cfg.sites;
    const cle = process.env.STACKEXCHANGE_KEY ? `&key=${process.env.STACKEXCHANGE_KEY}` : "";
    const lus = new Map<string, any>();
    for (const site of sites)
      for (const q of requetes) {
        const r = await lireJson(
          `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=${encodeURIComponent(q)}&site=${site}&fromdate=${Math.floor(o.depuis.getTime() / 1000)}&pagesize=${o.test ? 5 : cfg.parRequete}&filter=withbody${cle}`,
        );
        for (const it of r.items ?? []) lus.set(`${site}:${it.question_id}`, { ...it, site, q });
        if (r.backoff) await pause(r.backoff * 1000); // Stack Exchange demande parfois d'attendre
      }
    return [...lus.entries()]
      .map(([cleQ, it]) => ({ cleQ, it, titre: propre(it.title), texte: propre(it.body) }))
      .filter(({ it, titre, texte }) => cfg.filtre.test(`${titre} ${texte}`) && !c.exclure.test(`${it.owner?.display_name ?? ""} ${titre}`))
      .map(
        ({ cleQ, it, titre, texte }): Signal => ({
          id: `stack_exchange:${cleQ}`,
          source: "stack_exchange",
          plateforme: `Stack Exchange · ${it.site}`,
          type: "post",
          date: isoOuNull(it.creation_date),
          url: it.link ?? null,
          titre: titre.slice(0, 200),
          texte: texte.slice(0, 3000),
          entreprise: null,
          personne: it.owner?.display_name ? { nom: propre(it.owner.display_name), poste: null, url: it.owner.link ?? null } : null,
          requete: it.q,
          contexte: `${it.answer_count ?? 0} réponse(s) pour l'instant${it.tags?.length ? ` · étiquettes : ${it.tags.join(", ")}` : ""}`,
        }),
      );
  },
};

// GitHub : recherche d'issues et de discussions (gratuite ; 10 recherches par minute sans jeton, 30 avec GITHUB_TOKEN).
// Bon usage : `repo:<concurrent>/<projet> is:issue` (utilisateurs mécontents d'un outil open source) ou « alternative to X ».
export const github: Source = {
  id: "github",
  nom: "GitHub (issues)",
  async collecter(c, o) {
    const cfg = c.github;
    if (!cfg?.requetes.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const jeton: Record<string, string> = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const lus = new Map<number, any>();
    for (const [i, q] of requetes.entries()) {
      if (i && !jeton.Authorization) await pause(6500); // reste sous 10 recherches par minute
      const r = await lireJson(
        `https://api.github.com/search/issues?q=${encodeURIComponent(`${q} created:>=${o.depuis.toISOString().slice(0, 10)}`)}&sort=created&order=desc&per_page=${o.test ? 5 : cfg.parRequete}`,
        { Accept: "application/vnd.github+json", ...jeton },
      );
      for (const it of r.items ?? []) if (!lus.has(it.id)) lus.set(it.id, { ...it, q });
    }
    return [...lus.values()]
      .map((it) => ({ it, titre: propre(it.title), texte: propre(it.body) }))
      .filter(({ it, titre, texte }) => it.user?.type !== "Bot" && cfg.filtre.test(`${titre} ${texte}`) && !c.exclure.test(`${it.user?.login ?? ""} ${titre}`))
      .map(
        ({ it, titre, texte }): Signal => ({
          id: `github:${it.id}`,
          source: "github",
          plateforme: `GitHub · ${String(it.repository_url ?? "").replace("https://api.github.com/repos/", "")}`,
          type: "post",
          date: isoOuNull(it.created_at),
          url: it.html_url ?? null,
          titre: titre.slice(0, 200),
          texte: texte.slice(0, 3000),
          entreprise: null,
          personne: it.user?.login ? { nom: it.user.login, poste: null, url: it.user.html_url ?? null } : null,
          requete: it.q,
        }),
      );
  },
};

// Bluesky : recherche publique de posts (gratuite, sans compte, via api.bsky.app ; public.api.bsky.app refuse la recherche).
export const bluesky: Source = {
  id: "bluesky",
  nom: "Bluesky",
  async collecter(c, o) {
    const cfg = c.bluesky;
    if (!cfg?.requetes.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const lus = new Map<string, any>();
    for (const q of requetes) {
      const p = new URLSearchParams({ q, sort: "latest", since: o.depuis.toISOString(), limit: String(Math.min(100, o.test ? 10 : cfg.parRequete)) });
      if (cfg.langue) p.set("lang", cfg.langue);
      const r = await lireJson(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${p}`);
      for (const post of r.posts ?? []) if (!lus.has(post.uri)) lus.set(post.uri, { ...post, q });
    }
    return [...lus.values()]
      .map((p) => ({ p, texte: propre(p.record?.text) }))
      .filter(({ p, texte }) => cfg.filtre.test(texte) && !c.exclure.test(`${p.author?.displayName ?? ""} ${p.author?.handle ?? ""}`))
      .map(({ p, texte }): Signal => {
        const rkey = String(p.uri).split("/").pop();
        return {
          id: `bluesky:${p.uri}`,
          source: "bluesky",
          plateforme: "Bluesky",
          type: "post",
          date: isoOuNull(p.record?.createdAt ?? p.indexedAt),
          url: p.author?.handle ? `https://bsky.app/profile/${p.author.handle}/post/${rkey}` : null,
          titre: texte.slice(0, 120),
          texte: texte.slice(0, 2000),
          entreprise: null,
          personne: p.author ? { nom: `${p.author.displayName || p.author.handle} (@${p.author.handle})`, poste: null, url: `https://bsky.app/profile/${p.author.handle}` } : null,
          requete: p.q,
          contexte: p.record?.reply ? "Réponse dans une conversation" : undefined,
        };
      });
  },
};

// Avis App Store des applis concurrentes : thewolves/appstore-reviews-scraper, 0,0001 $ l'avis (essai du 18/10 : du plus
// récent au plus ancien). Le flux RSS gratuit d'Apple ne renvoie plus d'avis (vérifié le 18/10). On garde les avis
// mécontents (note ≤ noteMax) : ce sont des utilisateurs d'un concurrent prêts à changer. Auteurs anonymes : signal de
// marché (douleurs, arguments) plus que contact direct, sauf si l'avis nomme une entreprise.
export const appStore: Source = {
  id: "app_store",
  nom: "App Store (avis des concurrents)",
  async collecter(c, o) {
    const cfg = c.appStore;
    if (!cfg?.apps.length) return [];
    const apps = o.test ? cfg.apps.slice(0, 1) : cfg.apps;
    const parApp = o.test ? 20 : cfg.avisParApp;
    const lots = await Promise.allSettled(
      apps.map((a) => lancerActeur<any>("thewolves/appstore-reviews-scraper", { appIds: [a.id], country: cfg.pays, maxItems: parApp }, { estimation: parApp * 0.0001 + 0.002 }).then((l) => l.map((r) => ({ r, a })))),
    );
    lots.forEach((l, i) => l.status === "rejected" && console.warn(`  ⚠ App Store ${apps[i].nom} : ${l.reason instanceof Error ? l.reason.message : l.reason}`));
    if (lots.every((l) => l.status === "rejected")) throw new Error("tous les avis App Store ont échoué");
    return lots
      .flatMap((l) => (l.status === "fulfilled" ? l.value : []))
      .filter(({ r }) => r.date && new Date(r.date) >= new Date(o.depuis.getTime() - 86_400_000) && (r.score ?? 5) <= cfg.noteMax)
      .map(
        ({ r, a }): Signal => ({
          id: `app_store:${r.id}`,
          source: "app_store",
          plateforme: `App Store · ${a.nom}`,
          type: "avis",
          date: isoOuNull(r.date),
          url: r.url ?? null,
          titre: `${r.score}★ ${propre(r.title)}`.slice(0, 200),
          texte: propre(r.text).slice(0, 2000),
          entreprise: null,
          personne: r.userName ? { nom: r.userName, poste: null, url: null } : null,
          requete: a.nom,
          contexte: `Avis ${r.score}/5 sur l'appli ${a.nom} (concurrent du vendeur), version ${r.version ?? "?"}`,
        }),
      );
  },
};

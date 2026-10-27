import { fetchRobuste, isoOuNull, pause, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Forums publics sous Discourse (growthhacking.fr, vérifié le 18/10 : Discourse, JSON public, robots.txt autorise).
// Discourse publie ses derniers messages en JSON (/posts.json, 50 par page, du plus récent au plus ancien) : on lit
// tout ce qui a été écrit depuis le dernier passage, nouveaux sujets et réponses, gratuitement et sans clé.
// Le même code sert pour n'importe quel autre forum Discourse : il suffit d'ajouter son adresse à la campagne.
// Pas d'API pour la réponse : le client répond lui-même sur le forum.

const UA = { "User-Agent": "signal-engine (veille de signaux publics)", Accept: "application/json" };
const PAGES_MAX = 20; // 1 000 messages par forum et par passage, au-delà on s'arrête

async function derniersMessages(base: string, depuis: Date, pagesMax: number): Promise<any[]> {
  const lus: any[] = [];
  let avant: number | undefined;
  for (let page = 0; page < pagesMax; page++) {
    if (page) await pause(1000); // un forum associatif : on reste poli
    const r = await fetchRobuste(`${base}/posts.json${avant ? `?before=${avant}` : ""}`, { headers: UA });
    if (!r.ok) throw new Error(`${new URL(base).hostname} : ${r.status} ${(await r.text()).slice(0, 150)}`);
    const posts: any[] = (await r.json())?.latest_posts ?? [];
    if (!posts.length) break;
    lus.push(...posts);
    const plusAncien = posts.at(-1);
    if (new Date(plusAncien.created_at) < depuis) break;
    avant = Math.min(...posts.map((p) => p.id)) - 1;
  }
  return lus.filter((p) => new Date(p.created_at) >= depuis);
}

export const forums: Source = {
  id: "forums",
  nom: "Forums (Discourse)",
  async collecter(c, o) {
    const cfg = c.forums;
    if (!cfg?.sites.length) return [];
    const sites = o.test ? cfg.sites.slice(0, 1) : cfg.sites;
    const signaux: Signal[] = [];
    for (const f of sites) {
      const base = f.url.replace(/\/+$/, "");
      const posts = await derniersMessages(base, o.depuis, o.test ? 1 : PAGES_MAX);
      const gardes = posts
        .filter((p) => !p.hidden && !p.deleted_at && !p.user_deleted && p.post_type === 1) // 1 = message normal
        .map((p) => ({ p, sujet: propre(p.topic_title), texte: propre(p.raw ?? p.excerpt ?? p.cooked) }))
        .filter(({ p, sujet, texte }) => cfg.filtre.test(`${p.post_number === 1 ? sujet : ""} ${texte}`) && !c.exclure.test(`${p.name ?? ""} ${p.username ?? ""}`));
      console.log(`  · ${f.nom} : ${posts.length} messages depuis le dernier passage, ${gardes.length} retenus par le filtre (gratuit)`);
      for (const { p, sujet, texte } of gardes) {
        const nouveau = p.post_number === 1;
        signaux.push({
          id: `forums:${new URL(base).hostname}:${p.id}`,
          source: "forums",
          plateforme: f.nom,
          type: nouveau ? "post" : "commentaire",
          date: isoOuNull(p.created_at),
          url: `${base}/t/${p.topic_slug}/${p.topic_id}/${p.post_number}`,
          titre: (nouveau ? sujet : texte).slice(0, 200),
          texte: texte.slice(0, 3000),
          entreprise: null,
          personne: p.username ? { nom: p.name ? `${p.name} (@${p.username})` : p.username, poste: p.user_title ?? null, url: `${base}/u/${p.username}` } : null,
          requete: f.nom,
          contexte: nouveau
            ? `Nouveau sujet sur ${f.nom}${p.reply_count ? ` (${p.reply_count} réponse(s))` : " (aucune réponse pour l'instant)"}`
            : `Réponse dans le sujet « ${sujet} » sur ${f.nom}`,
        });
      }
    }
    return signaux;
  },
};

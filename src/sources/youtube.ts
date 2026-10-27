import { requis } from "../lib/env.js";
import { fetchRobuste, isoOuNull, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// YouTube : commentaires récents sous des vidéos du sujet, via l'API officielle YouTube Data v3 (gratuite).
// Quota : 10 000 unités par jour et par clé Google. Une recherche = 100 unités, une page de 100 commentaires = 1 unité :
// 4 recherches × 10 vidéos ≈ 440 unités par passage, soit une vingtaine de clients par clé.
// Les auteurs sont des pseudos (pas d'entreprise, pas de messagerie) : la réponse se fait sous le commentaire,
// à la main par le client (commentaire_public). Utile pour les logiciels et le grand public, pas pour un métier de terrain.

const API = "https://www.googleapis.com/youtube/v3";
type Video = { id: string; titre: string; chaine: string };

// La clé passe en en-tête, pas dans l'URL : elle n'apparaît dans aucun message d'erreur.
async function appeler(chemin: string, params: Record<string, string | number | undefined>): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const r = await fetchRobuste(`${API}/${chemin}?${qs}`, { headers: { "X-Goog-Api-Key": requis("YOUTUBE_API_KEY") } });
  const corps = await r.json();
  if (!r.ok) {
    const raison = corps?.error?.errors?.[0]?.reason ?? corps?.error?.status ?? r.status;
    throw Object.assign(new Error(`YouTube ${chemin} : ${raison} ${propre(corps?.error?.message).slice(0, 150)}`), { raison });
  }
  return corps;
}

export const youtube: Source = {
  id: "youtube",
  nom: "YouTube (commentaires)",
  async collecter(c, o) {
    const cfg = c.youtube;
    if (!cfg?.requetes.length && !cfg?.videos?.length) return [];
    const requetes = o.test ? cfg.requetes.slice(0, 1) : cfg.requetes;
    const parRequete = Math.min(50, o.test ? 3 : cfg.videosParRequete);
    const parVideo = Math.min(100, o.test ? 20 : cfg.commentairesParVideo);
    let unites = 0;

    // 1. Vidéos : les plus pertinentes pour chaque recherche (pas seulement les récentes : une vidéo « meilleur CRM »
    // d'il y a deux ans reçoit encore des questions chaque semaine), plus les vidéos suivies.
    const videos = new Map<string, Video & { requete: string }>();
    for (const v of o.test ? [] : (cfg.videos ?? [])) videos.set(v.id, { id: v.id, titre: v.nom, chaine: "", requete: v.nom });
    for (const q of requetes) {
      const r = await appeler("search", { part: "snippet", type: "video", q, maxResults: parRequete, order: "relevance", relevanceLanguage: cfg.langue, regionCode: cfg.region });
      unites += 100;
      for (const it of r.items ?? []) {
        const id = it.id?.videoId;
        if (id && !videos.has(id)) videos.set(id, { id, titre: propre(it.snippet?.title), chaine: propre(it.snippet?.channelTitle), requete: q });
      }
    }

    // 2. Commentaires les plus récents de chaque vidéo ; on garde ceux écrits depuis le dernier passage.
    const lus: { v: Video & { requete: string }; t: any }[] = [];
    let fermees = 0;
    const liste = [...videos.values()];
    for (let i = 0; i < liste.length; i += 5) {
      await Promise.all(
        liste.slice(i, i + 5).map(async (v) => {
          try {
            const r = await appeler("commentThreads", { part: "snippet", videoId: v.id, order: "time", maxResults: parVideo, textFormat: "plainText" });
            unites += 1;
            for (const t of r.items ?? []) lus.push({ v, t });
          } catch (e: any) {
            unites += 1;
            if (e?.raison === "commentsDisabled" || e?.raison === "videoNotFound" || e?.raison === "forbidden") fermees++;
            else throw e; // quotaExceeded, clé invalide… : la source échoue, les autres continuent
          }
        }),
      );
    }
    console.log(`  · YouTube : ${videos.size} vidéos, ${lus.length} commentaires lus${fermees ? `, ${fermees} vidéos sans commentaires` : ""}, ${unites} unités de quota (gratuit)`);

    return lus
      .map(({ v, t }) => ({ v, t, s: t.snippet?.topLevelComment?.snippet ?? {}, texte: propre(t.snippet?.topLevelComment?.snippet?.textDisplay) }))
      .filter(({ s }) => s.publishedAt && new Date(s.publishedAt) >= o.depuis)
      .filter(({ t, s }) => s.authorChannelId?.value !== t.snippet?.channelId) // la chaîne qui commente sa propre vidéo
      .filter(({ s, texte }) => cfg.filtre.test(texte) && !c.exclure.test(s.authorDisplayName ?? ""))
      .map(({ v, t, s, texte }): Signal => {
        const reponses = t.snippet?.totalReplyCount ?? 0;
        return {
          id: `youtube:${t.id}`,
          source: "youtube",
          plateforme: `YouTube${v.chaine ? ` · ${v.chaine}` : ""}`,
          type: "commentaire",
          date: isoOuNull(s.publishedAt),
          url: `https://www.youtube.com/watch?v=${v.id}&lc=${t.id}`,
          titre: texte.slice(0, 120),
          texte: texte.slice(0, 2000),
          entreprise: null,
          personne: s.authorDisplayName ? { nom: s.authorDisplayName, poste: null, url: s.authorChannelUrl ?? null } : null,
          requete: v.requete,
          contexte: `A commenté la vidéo « ${v.titre} »${v.chaine ? ` de la chaîne ${v.chaine}` : ""}${reponses ? ` (${reponses} réponse${reponses > 1 ? "s" : ""} déjà)` : " (aucune réponse pour l'instant)"}`,
        };
      });
  },
};

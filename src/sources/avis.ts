import { lancerActeur, PRIX } from "../lib/apify.js";
import { cleEntreprise, depuis, isoOuNull, propre } from "../lib/outils.js";
import { lireHistorique } from "../stockage.js";
import type { Signal, Source } from "../types.js";

// Avis Google Maps récents des sites d'un réseau (apify/crawler-google-places ; ~1,50 $ / 1 000 lieux + avis).
// Un réseau dont plusieurs sites reçoivent des avis « clim en panne », « toilettes hors service »… = douleur de maintenance.
// Un signal par réseau (pas par client mécontent) ; les noms des auteurs d'avis ne sont pas collectés.

export const avis: Source = {
  id: "avis",
  nom: "Sites d'avis · Google Maps",
  async collecter(c, o) {
    // Enseignes de la campagne + meilleures entreprises A/B déjà trouvées par les autres sources.
    const deja = new Map<string, { nom: string; score: number }>();
    for (const s of lireHistorique(c.id)) {
      const n = s.notation;
      if (n.note === "X" || !n.entreprise_cible) continue;
      const k = cleEntreprise(n.entreprise_cible);
      const score = n.score + (n.note === "A" ? 100 : 0);
      if ((deja.get(k)?.score ?? -1) < score) deja.set(k, { nom: n.entreprise_cible, score });
    }
    const historique = [...deja.values()].sort((a, b) => b.score - a.score).slice(0, c.avis.enseignesDepuisHistorique).map((x) => x.nom);
    const vues = new Set<string>();
    const enseignes = [...c.avis.enseignes, ...historique].filter((e) => !vues.has(cleEntreprise(e)) && vues.add(cleEntreprise(e)));
    const liste = o.test ? enseignes.slice(0, 1) : enseignes;
    if (!liste.length) return [];

    const nLieux = o.test ? 3 : c.avis.lieuxParEnseigne;
    const nAvis = o.test ? 10 : c.avis.avisParLieu;
    const lieux = await lancerActeur<any>("compass/crawler-google-places", {
      searchStringsArray: liste,
      locationQuery: "France",
      maxCrawledPlacesPerSearch: nLieux,
      language: "fr",
      maxReviews: nAvis,
      reviewsSort: "newest",
      reviewsStartDate: depuis(Math.max(o.jours, 30)).toISOString().slice(0, 10),
      scrapeReviewsPersonalData: false,
      scrapeContacts: false,
      skipClosedPlaces: true,
    }, { estimation: liste.length * nLieux * (PRIX.mapsLieu + nAvis * PRIX.mapsAvis), minutes: 20 });

    // Regroupe par enseigne recherchée.
    const parEnseigne = new Map<string, { lieux: Set<string>; extraits: string[]; date: string | null; total: number }>();
    for (const l of lieux) {
      const enseigne = l.searchString ?? l.title;
      const g = parEnseigne.get(enseigne) ?? { lieux: new Set(), extraits: [], date: null, total: 0 };
      for (const r of (l.reviews ?? []) as any[]) {
        g.total++;
        const texte = propre(r.text ?? r.textTranslated ?? "");
        if (!texte || !c.avis.probleme.test(texte)) continue;
        g.lieux.add(l.address ?? l.title);
        const d = isoOuNull(r.publishedAtDate);
        if (d && (!g.date || d > g.date)) g.date = d;
        if (g.extraits.length < 8) g.extraits.push(`« ${texte.slice(0, 220)} » (${r.stars ?? "?"}★, ${l.city ?? l.address ?? ""}${d ? `, ${d.slice(0, 10)}` : ""})`);
      }
      parEnseigne.set(enseigne, g);
    }

    const out: Signal[] = [];
    for (const [enseigne, g] of parEnseigne) {
      if (g.extraits.length < (o.test ? 1 : c.avis.minAvisProblemes)) continue;
      out.push({
        id: `avis:${cleEntreprise(enseigne)}:${new Date().toISOString().slice(0, 7)}`, // au plus un signal par enseigne et par mois
        source: "avis",
        plateforme: "Google Maps (avis)",
        type: "avis",
        date: g.date,
        url: `https://www.google.com/maps/search/${encodeURIComponent(enseigne)}`,
        titre: `${enseigne} : ${g.extraits.length} avis récents signalent un problème de maintenance sur ${g.lieux.size} site(s)`,
        texte: `Sur ${g.total} avis récents lus, ${g.extraits.length} parlent d'équipements en panne ou mal entretenus.\nSites concernés : ${[...g.lieux].slice(0, 6).join(" ; ")}\n\n${g.extraits.join("\n")}`,
        entreprise: enseigne,
        personne: null,
        requete: enseigne,
      });
    }
    return out;
  },
};

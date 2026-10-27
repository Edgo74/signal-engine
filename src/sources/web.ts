import { rechercheGoogle } from "../lib/google.js";
import { isoOuNull, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Recherche Google (Serper si SERPER_API_KEY, sinon Apify) avec des opérateurs site: :
// couvre Quora, Reddit, forums, pages Facebook publiques et posts LinkedIn indexés, sans compte.

const plateforme = (url: string) => {
  const h = new URL(url).hostname.replace(/^www\./, "");
  if (h.includes("quora")) return "Quora";
  if (h.includes("reddit")) return "Reddit";
  if (h.includes("facebook")) return "Facebook (public)";
  if (h.includes("linkedin")) return "LinkedIn (indexé)";
  if (h === "x.com" || h.includes("twitter")) return "X (indexé)";
  return h;
};

export const web: Source = {
  id: "web",
  nom: "Web, Quora, Reddit, Facebook public (Google)",
  async collecter(c, o) {
    const requetes = o.test ? c.web.requetes.slice(0, 2) : c.web.requetes;
    const resultats = await rechercheGoogle(requetes, { jours: o.jours, parRequete: o.test ? 5 : 10 });
    return resultats.map(
      (r): Signal => ({
        id: `web:${r.url}`,
        source: "web",
        plateforme: plateforme(r.url),
        type: "page_web",
        date: isoOuNull(r.date),
        url: r.url,
        titre: propre(r.titre),
        texte: propre(r.extrait).slice(0, 1000),
        entreprise: null,
        personne: null,
        requete: r.requete,
      }),
    );
  },
};

import { depuis, fetchRobuste, isoOuNull, propre } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// Google News (flux RSS public, sans clé) : ouvertures de sites, plans d'expansion, rachats de réseaux.

const balise = (xml: string, nom: string) =>
  xml.match(new RegExp(`<${nom}[^>]*>([\\s\\S]*?)</${nom}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") ?? "";

export const actualites: Source = {
  id: "actualites",
  nom: "Actualités (Google News)",
  async collecter(c, o) {
    const limite = depuis(o.jours);
    const requetes = o.test ? c.actualites.requetes.slice(0, 2) : c.actualites.requetes;
    const out: Signal[] = [];
    for (const q of requetes) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${o.jours}d`)}&hl=fr&gl=FR&ceid=FR:fr`;
      const r = await fetchRobuste(url, { headers: { "User-Agent": "Mozilla/5.0 signal-engine" } });
      if (!r.ok) {
        console.warn(`  ⚠ Google News « ${q} » : erreur ${r.status}`);
        continue;
      }
      const xml = await r.text();
      for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const date = isoOuNull(balise(item, "pubDate"));
        if (date && new Date(date) < limite) continue;
        const lien = propre(balise(item, "link"));
        const titre = propre(balise(item, "title"));
        out.push({
          id: `actualites:${lien || titre}`,
          source: "actualites",
          plateforme: `Google News · ${propre(balise(item, "source")) || "presse"}`,
          type: "actualite",
          date,
          url: lien || null,
          titre,
          texte: propre(balise(item, "description")).slice(0, 800) || titre,
          entreprise: null,
          personne: null,
          requete: q,
        });
      }
    }
    return out;
  },
};

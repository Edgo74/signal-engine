import { lancerActeur, PRIX } from "./apify.js";
import { reserver } from "./couts.js";

// Recherche Google. Avec SERPER_API_KEY : API Serper (~1 $ / 1 000 recherches, crédits offerts à l'inscription),
// sinon l'acteur Apify apify/google-search-scraper (plus cher).

export type Resultat = { url: string; titre: string; extrait: string; date: string | null; requete: string };

const PRIX_SERPER = 0.001;

export async function rechercheGoogle(requetes: string[], o: { jours?: number; parRequete: number }): Promise<Resultat[]> {
  if (!requetes.length) return [];
  const cle = process.env.SERPER_API_KEY;
  if (cle) {
    const fin = reserver("serper", requetes.length * PRIX_SERPER);
    const tbs = o.jours == null ? undefined : o.jours <= 1 ? "qdr:d" : o.jours <= 7 ? "qdr:w" : o.jours <= 31 ? "qdr:m" : "qdr:y";
    const out: Resultat[] = [];
    let faites = 0;
    try {
      for (const q of requetes) {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": cle, "Content-Type": "application/json" },
          body: JSON.stringify({ q, gl: "fr", hl: "fr", num: Math.min(o.parRequete, 10), ...(tbs ? { tbs } : {}) }),
        });
        if (!r.ok) throw new Error(`Serper : erreur ${r.status} ${(await r.text()).slice(0, 200)}`);
        faites++;
        const j = (await r.json()) as { organic?: { link: string; title: string; snippet?: string; date?: string }[] };
        for (const x of j.organic ?? []) out.push({ url: x.link, titre: x.title, extrait: x.snippet ?? "", date: x.date ?? null, requete: q });
      }
    } finally {
      fin(faites * PRIX_SERPER, `${faites} recherches`);
    }
    return out;
  }

  const pages = await lancerActeur<any>(
    "apify/google-search-scraper",
    {
      queries: requetes.join("\n"),
      countryCode: "fr",
      languageCode: "fr",
      maxPagesPerQuery: 1,
      resultsPerPage: o.parRequete,
      ...(o.jours == null ? {} : { quickDateRange: o.jours <= 1 ? "d1" : o.jours <= 7 ? "w1" : o.jours <= 31 ? "m1" : "y1" }),
    },
    { estimation: requetes.length * PRIX.googlePage },
  );
  return pages.flatMap((p) =>
    ((p.organicResults ?? []) as any[]).map((r) => ({ url: r.url, titre: r.title ?? "", extrait: r.description ?? "", date: r.date ?? null, requete: p.searchQuery?.term ?? "" })),
  );
}

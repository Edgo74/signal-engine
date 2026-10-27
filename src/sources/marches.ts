import { depuis, fetchRobuste, isoOuNull } from "../lib/outils.js";
import type { Signal, Source } from "../types.js";

// BOAMP (open data DILA, sans clé) : appels d'offres publics de maintenance.

export const marches: Source = {
  id: "marches",
  nom: "Appels d'offres publics (BOAMP)",
  async collecter(c, o) {
    if (!c.marches.requetes.length) return []; // le vendeur ne répond pas aux marchés publics
    const date = depuis(o.jours).toISOString().slice(0, 10);
    const filtre = c.marches.requetes.map((q) => `search(objet, "${q.replace(/"/g, "")}")`).join(" OR ");
    const taille = o.test ? 10 : 100;
    const out: Signal[] = [];
    for (let offset = 0; offset < (o.test ? 10 : 500); offset += taille) {
      const p = new URLSearchParams({
        where: `(${filtre}) AND dateparution >= date'${date}' AND nature = "APPEL_OFFRE"`,
        order_by: "dateparution desc",
        limit: String(taille),
        offset: String(offset),
        select: "idweb,objet,nomacheteur,dateparution,datelimitereponse,code_departement,descripteur_libelle",
      });
      const r = await fetchRobuste(`https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records?${p}`);
      if (!r.ok) throw new Error(`BOAMP : erreur ${r.status} ${(await r.text()).slice(0, 200)}`);
      const { results = [] } = (await r.json()) as { results?: any[] };
      for (const a of results) {
        out.push({
          id: `marches:${a.idweb}`,
          source: "marches",
          plateforme: "BOAMP",
          type: "appel_offres",
          date: isoOuNull(a.dateparution),
          url: `https://www.boamp.fr/pages/avis/?q=idweb:${a.idweb}`,
          titre: a.objet,
          texte: [
            `Acheteur : ${a.nomacheteur}`,
            `Départements : ${(a.code_departement ?? []).join(", ")}`,
            `Domaines : ${(a.descripteur_libelle ?? []).join(", ")}`,
            `Réponse avant le : ${a.datelimitereponse ?? "?"}`,
          ].join("\n"),
          entreprise: a.nomacheteur ?? null,
          personne: null,
          requete: "BOAMP",
        });
      }
      if (results.length < taille) break;
    }
    return out;
  },
};

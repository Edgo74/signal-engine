import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

// Compteur de coût par campagne : chaque dépense payante est écrite dans data/<campagne>/couts.jsonl.
// Deux plafonds : par mois (ce que le client rapporte) et par jour (garde-fou contre un passage qui s'emballe).
// Avant chaque appel payant, on réserve son coût estimé ; s'il dépasse ce qui reste, l'appel n'a pas lieu.
// Le coût réel est enregistré après coup (il peut être un peu au-dessus de l'estimation).

export type Depense = { le: string; campagne: string; poste: string; usd: number; detail?: string };
export type Budget = { usdParJour: number; usdParMois: number };

let campagne = "";
let budget: Budget = { usdParJour: Infinity, usdParMois: Infinity };
let dejaJour = 0; // aujourd'hui, avant ce passage
let dejaMois = 0;
let reserve = 0;
const passage: Depense[] = [];
const fichier = () => `data/${campagne}/couts.jsonl`;

export function ouvrirBudget(id: string, b: Budget) {
  campagne = id;
  budget = b;
  mkdirSync(`data/${id}`, { recursive: true });
  const jour = new Date().toISOString().slice(0, 10);
  const lignes = existsSync(fichier())
    ? readFileSync(fichier(), "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Depense)
    : [];
  dejaJour = lignes.filter((d) => d.le.startsWith(jour)).reduce((s, d) => s + d.usd, 0);
  dejaMois = lignes.filter((d) => d.le.startsWith(jour.slice(0, 7))).reduce((s, d) => s + d.usd, 0);
}

const ceTour = () => reserve + passage.reduce((s, d) => s + d.usd, 0);
export const reste = () => Math.min(budget.usdParJour - dejaJour, budget.usdParMois - dejaMois) - ceTour();

// Réserve `estimation` $ ; renvoie la fonction qui enregistre le coût réel et libère la réservation.
export function reserver(poste: string, estimation: number): (reel: number, detail?: string) => void {
  if (campagne && estimation > reste())
    throw new Error(
      `budget atteint pour « ${poste} » : estimé ${estimation.toFixed(3)} $, reste ${Math.max(0, reste()).toFixed(3)} $ (plafonds ${budget.usdParJour} $/jour, ${budget.usdParMois} $/mois)`,
    );
  reserve += estimation;
  let fait = false;
  return (reel, detail) => {
    if (fait) return;
    fait = true;
    reserve -= estimation;
    depenser(poste, reel, detail);
  };
}

export function depenser(poste: string, usd: number, detail?: string) {
  const d: Depense = { le: new Date().toISOString(), campagne, poste, usd: Math.round(usd * 1e5) / 1e5, ...(detail ? { detail } : {}) };
  passage.push(d);
  if (campagne && usd > 0) appendFileSync(fichier(), JSON.stringify(d) + "\n");
}

// Les petits coûts très nombreux (OpenAI) sont cumulés en mémoire puis écrits en une ligne par le bilan.
const cumuls = new Map<string, { usd: number; n: number }>();
export function cumuler(poste: string, usd: number) {
  const c = cumuls.get(poste) ?? { usd: 0, n: 0 };
  c.usd += usd;
  c.n++;
  cumuls.set(poste, c);
}

export function bilan(): string {
  for (const [poste, c] of cumuls) depenser(poste, c.usd, `${c.n} appels`);
  cumuls.clear();
  const parPoste = new Map<string, number>();
  for (const d of passage) parPoste.set(d.poste, (parPoste.get(d.poste) ?? 0) + d.usd);
  const total = [...parPoste.values()].reduce((s, v) => s + v, 0);
  const lignes = [...parPoste].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([p, v]) => `    ${p.padEnd(42)} ${v.toFixed(3)} $`);
  return `  Coût de ce passage : ${total.toFixed(3)} $ · aujourd'hui ${(dejaJour + total).toFixed(3)} / ${budget.usdParJour} $ · ce mois ${(dejaMois + total).toFixed(2)} / ${budget.usdParMois} $\n${lignes.join("\n")}`;
}

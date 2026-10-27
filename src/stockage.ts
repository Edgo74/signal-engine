import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SignalNote } from "./types.js";

// Stockage local simple (un dossier par campagne). À remplacer par Supabase quand il y aura une interface.
//   data/<campagne>/vus.json       identifiants déjà traités → pas de doublon d'un passage à l'autre
//   data/<campagne>/signaux.jsonl  historique de tous les signaux notés

const dossier = (campagne: string) => {
  const d = `data/${campagne}`;
  mkdirSync(d, { recursive: true });
  return d;
};

export function lireVus(campagne: string): Set<string> {
  const f = `${dossier(campagne)}/vus.json`;
  return new Set(existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as string[]) : []);
}

export function enregistrer(campagne: string, vus: Set<string>, notes: SignalNote[]) {
  const d = dossier(campagne);
  for (const s of notes) vus.add(s.id);
  writeFileSync(`${d}/vus.json`, JSON.stringify([...vus]));
  if (notes.length) appendFileSync(`${d}/signaux.jsonl`, notes.map((s) => JSON.stringify(s)).join("\n") + "\n");
}

export function lireHistorique(campagne: string): SignalNote[] {
  const f = `${dossier(campagne)}/signaux.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SignalNote);
}

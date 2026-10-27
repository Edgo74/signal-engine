import { existsSync } from "node:fs";

// Charge .env.local (Node ≥ 20.12) sans dépendance. Les valeurs ne sont jamais affichées.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export function requis(nom: string): string {
  const v = process.env[nom];
  if (!v) throw new Error(`${nom} manquant dans .env.local`);
  return v;
}

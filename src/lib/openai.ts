import { cumuler } from "./couts.js";
import { requis } from "./env.js";
import { pause } from "./outils.js";

// Repris de radar-emploi : budget de tokens par minute + respect des 429.
const FENETRE_MS = 60_000;
const BUDGET_TOKENS = 150_000;
const consommes: { t: number; n: number }[] = [];

async function attendreBudget(n: number) {
  for (;;) {
    const maintenant = Date.now();
    while (consommes.length && maintenant - consommes[0].t > FENETRE_MS) consommes.shift();
    const total = consommes.reduce((s, c) => s + c.n, 0);
    if (total + n <= BUDGET_TOKENS) {
      consommes.push({ t: maintenant, n });
      return;
    }
    await pause(Math.max(250, FENETRE_MS - (maintenant - consommes[0].t)));
  }
}

function enMs(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * 1000;
  let ms = 0;
  for (const [, n, u] of v.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[u as "ms"];
  return ms || null;
}

export async function appelerOpenAI<T>(messages: { role: string; content: string }[], nom: string, schema: object): Promise<T> {
  const key = requis("OPENAI_API_KEY");
  const estimation = Math.ceil(JSON.stringify(messages).length / 3) + 800;

  for (let essai = 0; ; essai++) {
    await attendreBudget(estimation);
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
          messages,
          response_format: { type: "json_schema", json_schema: { name: nom, strict: true, schema } },
        }),
      });
    } catch (e) {
      if (essai >= 3) throw e;
      await pause(2000 * 2 ** essai);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (essai >= 4) throw new Error(`OpenAI : erreur ${res.status} après ${essai + 1} essais`);
      const attente = enMs(res.headers.get("retry-after")) ?? enMs(res.headers.get("x-ratelimit-reset-tokens")) ?? 2000 * 2 ** essai;
      await pause(Math.min(Math.max(attente, 1000), 20_000) + Math.random() * 500);
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI : erreur ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    compterTokens(data.usage);
    return JSON.parse(data.choices[0].message.content) as T;
  }
}

// Prix en $ par million de tokens, à recopier depuis la page tarifs OpenAI du modèle utilisé (.env.local).
const PRIX_ENTREE = Number(process.env.OPENAI_PRIX_ENTREE ?? NaN);
const PRIX_SORTIE = Number(process.env.OPENAI_PRIX_SORTIE ?? NaN);
let averti = false;
function compterTokens(u?: { prompt_tokens: number; completion_tokens: number }) {
  if (!u) return;
  if (Number.isNaN(PRIX_ENTREE) || Number.isNaN(PRIX_SORTIE)) {
    if (!averti) console.warn("  ⚠ OPENAI_PRIX_ENTREE / OPENAI_PRIX_SORTIE absents : le coût OpenAI n'est pas compté");
    averti = true;
    return;
  }
  cumuler("openai", (u.prompt_tokens * PRIX_ENTREE + u.completion_tokens * PRIX_SORTIE) / 1e6);
}

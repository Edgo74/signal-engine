export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Réessaie sur 429 / 5xx / coupure réseau, avec attente croissante.
export async function fetchRobuste(url: string, init: RequestInit = {}, essais = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || i >= essais || (res.status < 500 && res.status !== 429)) return res;
    } catch (e) {
      if (i >= essais) throw e;
    }
    await pause(1500 * 2 ** i);
  }
}

export const depuis = (jours: number) => new Date(Date.now() - jours * 86_400_000);

export const isoOuNull = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const propre = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// Normalise un nom d'entreprise pour regrouper « American Vintage SAS » et « AMERICAN VINTAGE ».
export const cleEntreprise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sas|sasu|sa|sarl|eurl|snc|groupe|group|france)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

import { NAF_INTERMEDIAIRES, resumeFiche } from "./entreprises.js";
import { appelerOpenAI } from "./lib/openai.js";
import { TYPES_SIGNAL, type Campagne, type Notation, type Signal } from "./types.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["note", "score", "entreprise_cible", "secteur", "sites_estimes", "type_signal", "urgence", "pourquoi", "qui_contacter", "accroche", "message", "commentaire_public"],
  properties: {
    note: { type: "string", enum: ["A", "B", "X"] },
    score: { type: "integer", description: "0 à 100 : force du signal et adéquation de l'entreprise, pour trier dans une même note." },
    entreprise_cible: { type: "string", description: "Nom propre de l'entreprise à démarcher (pas l'auteur s'il est prestataire ou recruteur). Chaîne vide si aucune." },
    secteur: { type: "string", description: "Ex. « agence immobilière », « réseau de crèches », « éditeur SaaS », « acheteur public »." },
    sites_estimes: {
      type: "string",
      description: "Taille de l'entreprise (salariés, nombre de sites) seulement si le texte le dit ou si c'est une entreprise connue dont tu es sûr, sinon « inconnu ». Ne devine pas un chiffre précis.",
    },
    type_signal: { type: "string", enum: [...TYPES_SIGNAL] },
    urgence: { type: "string", description: "Les mots exacts du texte qui donnent un délai ou une urgence (« ce trimestre », « au plus vite », « avant septembre »). Chaîne vide s'il n'y en a pas." },
    pourquoi: { type: "string", description: "1 à 2 phrases factuelles : ce que dit le signal et pourquoi c'est le moment de contacter." },
    qui_contacter: { type: "string", description: "La personne nommée dans le signal si elle est décideur, sinon l'intitulé de poste à chercher dans l'entreprise. Vide si X." },
    accroche: {
      type: "string",
      description:
        "Si A ou B : la première phrase du message, qui cite précisément ce qui s'est passé (le post, le commentaire, l'offre, l'annonce) avec un détail concret tiré du texte. Si tu ne peux pas écrire une accroche précise, la note ne peut pas être A. Vide si X.",
    },
    message: {
      type: "string",
      description:
        "Si A ou B : premier message complet en français, vouvoiement, moins de 100 mots, qui commence par l'accroche. Ensuite une phrase utile liée à leur situation (une idée, une question), l'offre du vendeur en une phrase, et une question ouverte. Pas de demande de rendez-vous, pas de liste de fonctionnalités, ne dis pas « j'ai vu que vous avez liké ». N'invente aucun chiffre ni client. Vide si X.",
    },
    commentaire_public: {
      type: "string",
      description:
        "Seulement pour un post LinkedIn, Facebook ou Bluesky, un commentaire YouTube ou une question Stack Exchange, où la personne demande de l'aide, un avis ou un outil : 2 à 3 phrases à publier en réponse, dans la langue de la personne, qui apportent une vraie réponse, sans proposer de rendez-vous. Sur YouTube, si la personne demande quel outil choisir et que l'offre du vendeur y répond, tu peux la citer par son nom en disant que tu y travailles (jamais en te faisant passer pour un simple utilisateur), sans lien. Chaîne vide dans tous les autres cas (Reddit, forums, avis, offres d'emploi, actualités, appels d'offres) : là, on contacte la personne ailleurs.",
    },
  },
} as const;

const formater = (s: Signal) =>
  [
    `Source : ${s.plateforme} (${s.type})`,
    `Date : ${s.date ?? "inconnue"}`,
    `Entreprise indiquée par la source : ${s.entreprise ?? "aucune"}`,
    s.fiche && `Fiche entreprise (${s.fiche.source === "registre" ? "registre officiel, trouvée par son nom" : "page LinkedIn"}) : ${resumeFiche(s.fiche)}`,
    s.personne && `Personne : ${s.personne.nom} — ${s.personne.poste ?? "poste inconnu"}`,
    s.contexte && `Contexte : ${s.contexte}`,
    `Titre : ${s.titre}`,
    `Texte :\n${s.texte.slice(0, 3500)}`,
  ]
    .filter(Boolean)
    .join("\n");

const X = (pourquoi: string): Notation => ({
  note: "X",
  score: 0,
  entreprise_cible: "",
  secteur: "",
  sites_estimes: "inconnu",
  type_signal: "autre",
  urgence: "",
  pourquoi,
  qui_contacter: "",
  accroche: "",
  message: "",
  commentaire_public: "",
});

// Écarte sans IA ce qui ne peut jamais être une cible (économise des tokens).
export function filtreRapide(c: Campagne, s: Signal): Notation | null {
  for (const champ of [s.entreprise, s.personne?.poste, s.type === "offre_emploi" ? s.titre : null]) {
    const m = champ?.match(c.exclure);
    if (m) return X(`Écarté automatiquement : « ${m[0]} » (prestataire, intérim ou cabinet).`);
  }
  if (s.fiche?.sur && s.fiche.naf && NAF_INTERMEDIAIRES.includes(s.fiche.naf))
    return X(`Écarté automatiquement : ${s.fiche.nom} est une agence d'intérim ou un cabinet de placement (code NAF ${s.fiche.naf}).`);
  if (s.fiche?.sur && s.fiche.secteur && /staffing|recruiting|recrutement/i.test(s.fiche.secteur))
    return X(`Écarté automatiquement : ${s.fiche.nom} est un cabinet de recrutement (secteur LinkedIn « ${s.fiche.secteur} »).`);
  if (s.texte.length < 30 && !s.personne) return X("Écarté automatiquement : texte trop court.");
  return null;
}

export async function noter(c: Campagne, s: Signal): Promise<Notation> {
  const rapide = filtreRapide(c, s);
  if (rapide) return rapide;
  const n = await appelerOpenAI<Notation>(
    [
      {
        role: "system",
        content: `Tu qualifies des signaux d'achat publics pour l'équipe commerciale d'un vendeur B2B. Pour chaque signal, décide s'il révèle une entreprise à démarcher maintenant.

LE VENDEUR
${c.vendeur}

QUI EST UNE BONNE CIBLE ET COMMENT NOTER
${c.icp}

Règles :
- Juge l'entreprise CIBLE, pas l'auteur du post : un prestataire qui annonce avoir gagné un client révèle ce client (souvent déjà pris : au mieux B).
- Une offre d'emploi publiée par un cabinet ou une agence pour un client anonyme vaut X.
- Ne te fie qu'au texte et à la fiche entreprise. N'invente ni nom, ni chiffre, ni événement.
- La fiche entreprise vient du registre officiel ou de LinkedIn : utilise-la pour la taille (sites_estimes) et le secteur. Elle a été trouvée par le nom : si elle ne colle pas avec le texte (autre activité, autre pays), ignore-la.
- Sois exigeant : la note A doit donner envie d'appeler aujourd'hui.
- Ce qui fait monter la note et le score : une demande explicite (« vous connaissez quelqu'un », « je cherche », « on évalue », « alternative à », « on quitte notre prestataire ») ; un délai (« ce trimestre », « urgent », « avant la rentrée ») ; un décideur qui parle de son équipe, de son budget ou de son entreprise.
- Ce qui la fait baisser : une simple opinion sur le sujet, un contenu de veille ou de formation, un signal vieux ou vague.
- Règle de l'accroche : un signal A doit permettre une première phrase qui cite précisément ce qui s'est passé. Sinon, B au mieux.
- Un signal trouvé sur Reddit, un forum, Quora ou X : la personne se contacte ailleurs (LinkedIn, email), jamais en répondant sur place.`,
      },
      { role: "user", content: formater(s) },
    ],
    "notation_signal",
    SCHEMA,
  );
  return { ...n, score: Math.max(0, Math.min(100, Math.round(n.score))) };
}

// Exécute `f` sur chaque élément avec au plus `n` appels en parallèle.
export async function enParallele<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let suivant = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (suivant < items.length) {
        const i = suivant++;
        out[i] = await f(items[i], i);
      }
    }),
  );
  return out;
}

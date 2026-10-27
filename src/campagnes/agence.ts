import type { Campagne } from "../types.js";

// Campagne d'exemple : une agence IA qui cherche des TPE/PME.

export const agence: Campagne = {
  id: "agence",
  nom: "Agence IA · TPE/PME",
  budget: { usdParJour: 1, usdParMois: 15 },
  rythmes: { emplois: 24 },
  vendeur: `Une agence française d'automatisation par l'IA, qui démarre. Elle met en place, clés en main :
- un standard téléphonique IA 24 h/24 (prise de rendez-vous, réponses aux questions, qualification des appels) ;
- des systèmes de prospection : trouver des prospects qui correspondent au client idéal, les mettre dans un Google Sheet, envoyer des emails de prospection ;
- des assistants et agents IA (boîte mail, prise de rendez-vous, tâches répétitives, intégration au CRM) ;
- la visibilité dans les réponses de ChatGPT, Gemini et Perplexity (GEO) ;
- la création de contenu pour les réseaux sociaux et la rédaction (site, pages, emails) avec l'IA.`,
  icp: `Ce que le vendeur cherche : une TPE ou PME française (environ 2 à 200 personnes) qui perd du temps ou de l'argent sur une tâche que l'IA peut faire, et qui le montre publiquement maintenant.
Exemples de cibles : agences immobilières, cabinets (comptables, avocats, conseil), artisans et entreprises du bâtiment, garages, centres de formation, cliniques et cabinets paramédicaux privés, e-commerce, entreprises de services B2B, restaurants et hôtels indépendants.
Décideurs : dirigeant, gérant, fondateur, associé ; dans une PME aussi directeur commercial, marketing ou des opérations.

A = besoin réel et visible maintenant :
  - elle cherche un prestataire, un freelance ou une agence pour automatiser, mettre en place un agent ou un chatbot IA, un standard téléphonique, de la prospection, ou demande des recommandations ;
  - elle se plaint de ne pas pouvoir répondre au téléphone, de manquer des appels ou des rendez-vous, de passer trop de temps sur la prospection ou l'administratif ;
  - une petite entreprise recrute un(e) standardiste, secrétaire / assistant(e) d'accueil téléphonique, assistant(e) commercial(e) pour la prise de rendez-vous ou la prospection, ou un(e) chargé(e) de prospection : une partie de ce poste peut être confiée à l'IA ;
  - elle demande comment apparaître dans ChatGPT / les réponses des IA.
B = bonne cible, besoin moins direct :
  - un dirigeant de TPE/PME parle de l'IA ou de l'automatisation, dit vouloir s'y mettre ou ne pas savoir par où commencer ;
  - elle recrute un community manager ou un business developer junior dans une petite structure ;
  - elle se lance, lève des fonds ou grandit vite et doit trouver des clients.
X = pas de besoin pour le vendeur :
  - les agences IA, freelances automatisation, éditeurs de logiciels et consultants qui font leur promotion (concurrents) ;
  - grands groupes (plus de 500 personnes), administrations, acheteurs publics ;
  - cabinets de recrutement et agences d'intérim qui recrutent pour un client ;
  - une personne qui cherche un emploi ou une formation ;
  - articles généraux sur l'IA sans entreprise ni personne qui exprime un besoin ;
  - entreprises hors de France (Belgique, Suisse, Québec acceptés en B seulement si le besoin est direct).`,
  decideurs: ["Dirigeant / gérant / fondateur", "Associé", "Directeur commercial", "Directeur marketing", "Directeur des opérations"],
  exclure:
    /\b(adecco|randstad|manpower|synergie|proman|crit|start people|actual|partnaire|iziwork|gojob|interim|intérim|hays|michael page|page personnel|robert half|expectra|cabinet de recrutement)\b/i,

  linkedin: {
    requetes: [
      { q: "je cherche un freelance automatisation" },
      { q: "recherche prestataire intelligence artificielle" },
      { q: "quelqu'un connaît une agence IA" },
      { q: "agent IA pour mon entreprise" },
      { q: "automatiser la prospection" },
      { q: "standard téléphonique saturé" },
      { q: "apparaître dans ChatGPT" },
      { q: "IA", auteur: "gérant" },
      { q: "automatisation", auteur: "fondateur" },
    ],
    postsParRequete: 30,
    comptesSurveilles: [],
    postsParCompte: 0,
    reactionsParPost: 0,
    commentairesParPost: 20,
    titresEngagement: /(g[ée]rant|fondat|co-?fondat|founder|ceo|dirigeant|pr[ée]sident|associ[ée]|directeur (g[ée]n[ée]ral|commercial|marketing|des op[ée]rations)|owner|entrepreneur)/i,
    plaintes: {
      requetes: ["agent IA entreprise", "automatisation TPE PME", "IA pour les PME", "prospection commerciale temps"],
      postsParRequete: 5,
      postsCommentes: 5,
      commentairesParPost: 20,
      texte: /(on cherche|nous cherchons|je cherche|recherch|qui conna[iî]t|vous recommand|des recommandations|int[ée]ress[ée]|par o[uù] commencer|comment (faire|on fait)|j'aimerais|besoin|on perd|je perds|pas le temps|chronophage|gal[èe]re|m[eê]me probl[èe]me|m[eê]me constat|tellement vrai|en mp|me contacter|je prends)/i,
    },
  },

  facebook: {
    groupes: [], // à remplir après `npm run groupes -- agence`
    postsParGroupe: 20,
    filtre: /(automatis|intelligence artificielle|\bia\b|chatbot|agent|standard|t[ée]l[ée]phon|prospection|rendez-vous|recommand|quelqu'un conna[iî]t|cherche|recherche)/i,
    decouverte: [
      'site:facebook.com/groups entrepreneurs France entraide',
      'site:facebook.com/groups "chefs d\'entreprise" TPE PME',
      'site:facebook.com/groups artisans entrepreneurs bâtiment',
      'site:facebook.com/groups agents immobiliers indépendants',
    ],
  },

  avis: { enseignes: [], enseignesDepuisHistorique: 0, lieuxParEnseigne: 0, avisParLieu: 0, probleme: /$^/, minAvisProblemes: 99 },

  emplois: {
    motsCles: ["standardiste", "secrétaire accueil téléphonique", "assistant commercial prise de rendez-vous", "chargé de prospection", "téléprospecteur", "assistante administrative TPE"],
    apifyLinkedIn: false, // France Travail + Adzuna (gratuits) suffisent pour ce test
  },

  actualites: {
    requetes: ["PME adopte intelligence artificielle", "TPE automatisation témoignage", "entreprise lève des fonds recrute commerciaux"],
  },

  marches: { requetes: [] },

  web: {
    // Reddit, Quora et forums via Google (Serper).
    requetes: [
      'site:reddit.com (automatiser OR automatisation) "mon entreprise" IA',
      'site:reddit.com/r/vosfinances OR site:reddit.com/r/france "standard téléphonique"',
      'site:reddit.com "agent IA" (PME OR TPE OR artisan)',
      'site:reddit.com "apparaître dans ChatGPT"',
      'site:quora.com automatiser petite entreprise IA',
      'site:x.com ("je cherche" OR "vous recommandez") (agence OR freelance) (IA OR automatisation)',
      'site:x.com "standard téléphonique" (galère OR saturé OR "personne ne répond")',
      'site:forum.entrepreneurs.fr OR site:forum-entrepreneur.fr automatisation IA',
    ],
  },
  // Forums Discourse lus en entier (gratuit). Growthhacking.fr : fondateurs, commerciaux et marketeurs qui cherchent
  // des leads, des outils ou de l'automatisation (environ 20 nouveaux sujets par mois, octobre 2026).
  forums: {
    sites: [{ nom: "Growthhacking.fr", url: "https://www.growthhacking.fr" }],
    filtre: /cherch|recommand|conseil|quelqu'un (conna[iî]t|a d[ée]j[aà])|vous utilisez|quel(le)?s? (outil|logiciel|solution|agence|freelance)|automatis|scrap|\bia\b|agent|chatbot|prospect|leads?\b|cold ?(email|mail|call)|galère|besoin|aide/i,
  },
};

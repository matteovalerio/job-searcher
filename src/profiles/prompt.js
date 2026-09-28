import { resolveProfile } from '../config.js';
import { REMOTE_SCOPES } from './builder.js';

/*
 * Creazione del profilo con l'aiuto di Claude, usando l'abbonamento (claude.ai) invece dell'API:
 * `profile prompt` prepara il testo da incollare nella chat insieme al CV, `profile import` legge la risposta,
 * la controlla e la salva.
 */

// Esempio mostrato a Claude: un profilo completo e realistico, così segue formato e stile.
const EXAMPLE = {
  name: 'Redattrice editoria scientifica - Padova',
  description: '7 anni di esperienza in redazione · Laurea magistrale in linguistica',
  keywords: [
    'redattore',
    'redattrice',
    'redazione',
    'editor',
    'editorial*',
    'correttore di bozze',
    'proofread*',
    'journal',
    'peer review',
  ],
  relatedKeywords: ['impaginat*', 'indesign', 'traduttore', 'translator'],
  languages: ['italiano', 'italiana', 'italian', 'inglese', 'english'],
  excludeKeywords: ['video', 'software', 'sales', 'commerciale', 'stage', 'tirocinio', 'internship'],
  boostKeywords: [
    'casa editrice',
    'editoria',
    'scientifica',
    'scientific',
    'riviste',
    'autori',
    'elsevier',
    'springer',
  ],
  matchIn: 'title',
  maxAgeDays: 30,
  targets: [
    {
      id: 'padova-vicenza',
      label: 'Padova, Vicenza e dintorni',
      type: 'area',
      places: ['Padova', 'Vicenza'],
      country: 'it',
      radiusKm: 35,
      searchKeywords: ['redattore', 'redattrice', 'editor', 'editoriale', 'correttore di bozze'],
    },
    {
      id: 'remote',
      label: 'Full remote (Italia ed Europa)',
      type: 'remote',
      searchKeywords: ['editor', 'copy editor', 'proofreader', 'journal', 'redattore'],
      acceptedRegions: REMOTE_SCOPES.europa.regions,
      linkedinLocations: REMOTE_SCOPES.europa.linkedin,
    },
  ],
};

/** Testo da incollare su claude.ai. Se `cvText` è vuoto, chiede di allegare il CV. */
export function buildPrompt({ cvText = '' } = {}) {
  const scopes = Object.entries(REMOTE_SCOPES)
    .map(
      ([key, s]) =>
        `   - ${s.label}: acceptedRegions ${JSON.stringify(s.regions)}, linkedinLocations ${JSON.stringify(s.linkedin)}`,
    )
    .join('\n');
  return `Aiutami a creare un profilo di ricerca lavoro per il programma "job-searcher", che cerca offerte su LinkedIn, Indeed, InfoJobs e altri portali e le filtra con le regole del profilo.

${cvText ? `Ecco il CV del candidato (testo estratto dal PDF):\n\n<cv>\n${cvText.trim()}\n</cv>` : 'Il CV del candidato è allegato a questo messaggio.'}

COME PROCEDERE
1. Leggi il CV e riassumi in poche righe: ruoli svolti, anni di esperienza, studi, lingue con livello, competenze, città.
2. Prima di scrivere il profilo fammi le domande che servono, tutte insieme in un unico messaggio:
   - che lavori cerca (gli stessi del CV, ruoli affini, un cambio di settore?);
   - in quali città italiane e con che raggio in km;
   - se vuole anche offerte full remote, e da dove: solo Italia, Italia ed Europa, tutto il mondo;
   - se ci sono settori, aziende o tipi di lavoro da evitare.
3. Dopo le mie risposte scrivi il profilo come UN SOLO blocco di codice \`\`\`json, senza commenti dentro il JSON.

COME FUNZIONA IL PROGRAMMA (serve a scegliere bene le parole)
- keywords: un'offerta viene tenuta solo se il suo TITOLO contiene almeno una di queste parole. Metti le varianti italiane e inglesi, maschile e femminile ("redattore", "redattrice", "editor"). Si cercano parole intere, maiuscole e accenti non contano; "*" finale indica un prefisso ("editorial*" trova editoriale, editorial, editoriali). 10-25 parole.
- relatedKeywords: ruoli affini, plausibili ma meno centrali. Tengono l'offerta ma con punteggio più basso.
- excludeKeywords: se il titolo ne contiene una, l'offerta viene scartata. Servono a togliere i falsi positivi delle keywords (es. "video" per "video editor", "sales" per "promotore editoriale"). Con 2 o più anni di esperienza aggiungi stage, tirocinio, internship, intern, apprendista. Non escludere mai parole che fanno parte dei ruoli cercati.
- boostKeywords: alzano il punteggio se compaiono nell'annuncio (titolo, descrizione o nome dell'azienda): settore, competenze, nomi di aziende adatte al candidato, anche del territorio.
- languages: le lingue che il candidato conosce bene (B2 o più), in tutte le forme con cui compaiono negli annunci (es. "inglese", "english"). Le offerte che nel titolo chiedono altre lingue vengono scartate. Includi sempre "italiano", "italiana", "italian".
- targets: dove cercare.
  - type "area": "places" sono nomi di comuni italiani scritti correttamente (il programma li cerca in un elenco ufficiale), "radiusKm" il raggio. Vale anche tutta la provincia dei comuni indicati.
  - type "remote": solo offerte full remote. Usa i valori esatti in base alla scelta:
${scopes}
  - searchKeywords (in ogni target): le ricerche da fare sui portali, 4-8 parole brevi e generiche. Ogni parola è una ricerca per ogni portale, quindi non esagerare. Per il remoto includi anche termini inglesi.
- matchIn: lascia "title". maxAgeDays: giorni di anzianità massima delle offerte (30 va bene; 60 se in zona ci sono poche offerte).
- name: un nome breve e descrittivo. description: una riga con esperienza e studi.

ESEMPIO DI PROFILO VALIDO (per una redattrice, adattalo al candidato):
\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`
`;
}

/**
 * Estrae il profilo dalla risposta di Claude: un blocco ```json, oppure il testo dal primo "{" all'ultimo "}".
 */
export function extractJson(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (!fenced.length && (start < 0 || end < start)) {
    throw new Error("Nel testo non c'è nessun profilo JSON. Copia tutto il blocco ```json della risposta di Claude.");
  }
  // Se ci sono più blocchi (es. una prima versione e una corretta) vale l'ultimo.
  const candidates = fenced.length ? fenced.reverse() : [text.slice(start, end + 1)];
  let lastError;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Non trovo un profilo JSON valido nel testo${lastError ? ` (${lastError.message})` : ''}. ` +
      'Copia tutto il blocco ```json della risposta di Claude.',
  );
}

/**
 * Completa e controlla un profilo importato. Gli errori sono pensati per essere rigirati a Claude.
 * @returns {object} il profilo pronto da salvare
 */
export function checkImported(raw) {
  const profile = { matchIn: 'title', customSources: [], ...raw };
  if (!profile.name) throw new Error('Manca "name" (il nome del profilo)');
  if (!Array.isArray(profile.keywords) || !profile.keywords.length) throw new Error('Manca la lista "keywords"');
  for (const field of ['keywords', 'relatedKeywords', 'excludeKeywords', 'boostKeywords', 'languages']) {
    if (profile[field] !== undefined && !Array.isArray(profile[field])) {
      throw new Error(`"${field}" deve essere una lista di parole`);
    }
  }
  resolveProfile(profile); // stesse verifiche della ricerca: target, comuni, fonti
  return profile;
}

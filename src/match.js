import { describeInfo } from './extract.js';
import { shortId } from './tracking.js';

/*
 * Confronto tra CV e offerte con l'aiuto di Claude, usando l'abbonamento (claude.ai) invece dell'API:
 * si prepara un testo con il candidato e le offerte migliori dell'ultima ricerca, da incollare nella chat.
 * Claude le ordina per affinità, spiega punti di forza e lacune e, se richiesto, scrive le lettere.
 */

const MAX_DESCRIPTION = 700;

const clip = (text, max) => {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
};

/**
 * Sceglie le offerte da confrontare dagli ultimi risultati: quelle indicate per codice, altrimenti le migliori
 * per punteggio (senza doppioni tra le zone e senza quelle scartate).
 * @param {object} last  ultimi risultati salvati (vedi saveLastResults)
 * @param {{ ids?: string[], top?: number, hidden?: (job: object) => boolean }} [options]
 */
export function pickJobs(last, { ids, top = 15, hidden = () => false } = {}) {
  const seen = new Set();
  const all = last.targets
    .flatMap((t) => t.jobs.map((job) => ({ ...job, targetLabel: t.target.label })))
    .filter((job) => {
      if (seen.has(job.id) || hidden(job)) return false;
      seen.add(job.id);
      return true;
    });
  if (ids?.length) {
    const wanted = new Set(ids);
    const picked = all.filter((job) => wanted.has(shortId(job)));
    const missing = ids.filter((id) => !picked.some((job) => shortId(job) === id));
    if (missing.length) throw new Error(`Offerte non trovate negli ultimi risultati: ${missing.join(', ')}`);
    return picked;
  }
  return [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, top);
}

function describeCandidate(profile, cvText) {
  if (cvText) return `Ecco il CV del candidato (testo estratto dal PDF):\n\n<cv>\n${cvText.trim()}\n</cv>`;
  const lines = [
    profile.description && `Descrizione: ${profile.description}`,
    profile.candidate?.years && `Anni di esperienza: ${profile.candidate.years}`,
    profile.candidate?.education?.length &&
      `Studi: ${profile.candidate.education.map((e) => (e.field ? `${e.level} in ${e.field}` : e.level)).join(', ')}`,
    profile.candidate?.skills?.length && `Competenze: ${profile.candidate.skills.join(', ')}`,
    profile.keywords?.length && `Ruoli cercati: ${profile.keywords.slice(0, 15).join(', ')}`,
  ].filter(Boolean);
  return (
    'Il CV del candidato è allegato a questo messaggio. In sintesi, dal suo profilo di ricerca:\n' +
    lines.map((l) => `- ${l}`).join('\n')
  );
}

function describeJob(job) {
  const lines = [
    `### [${shortId(job)}] ${job.title}`,
    [job.company, job.location, job.targetLabel].filter(Boolean).join(' · '),
    describeInfo(job.info),
    job.postedAt ? `Pubblicata: ${job.postedAt.slice(0, 10)}` : '',
    job.url,
    job.description
      ? `\n${clip(job.description, MAX_DESCRIPTION)}`
      : '(nessuna descrizione disponibile: valuta dal titolo)',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Testo da incollare su claude.ai. */
export function buildMatchPrompt({ profile, jobs, cvText = '' }) {
  if (!jobs.length) throw new Error('Nessuna offerta da confrontare: lancia prima una ricerca.');
  return `Aiutami a scegliere a quali offerte di lavoro candidarmi.

${describeCandidate(profile, cvText)}

Qui sotto ci sono ${jobs.length} offerte trovate dal programma di ricerca. Ognuna ha un codice tra parentesi quadre, per esempio [a1b2c3d]: usalo sempre per riferirti a un'offerta, perché con quel codice le segno nel programma.

COSA TI CHIEDO
1. Ordina le offerte dalla più adatta alla meno adatta al candidato, in una tabella con: codice, titolo, azienda, voto da 1 a 5, motivo in una riga.
2. Per le 3-5 più adatte spiega in breve: punti di forza del candidato per quel ruolo, eventuali lacune o requisiti mancanti, cosa sottolineare nella candidatura.
3. Segnala le offerte da evitare e perché (requisiti molto diversi, livello troppo alto o basso, contratto poco chiaro, possibili annunci poco seri).
4. Non inventare informazioni sulle offerte: se la descrizione manca o è troppo breve, dillo.
5. Alla fine chiedimi per quali offerte voglio una lettera di presentazione. Scrivila nella lingua dell'annuncio, breve (massimo 250 parole), concreta, basata solo su esperienze reali del CV.

LE OFFERTE

${jobs.map(describeJob).join('\n\n')}
`;
}

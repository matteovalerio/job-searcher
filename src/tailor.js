import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateDir } from './paths.js';
import { bestContact } from './publishers/people.js';
import { PUBLISHING_SECTORS, sectorById } from './publishers/sectors.js';
import { detectSpecialties, PUBLISHER_KINDS, SPECIALTIES } from './publishers/specialties.js';

/*
 * CV su misura per un'offerta o per una casa editrice.
 *
 * Due parti:
 *   1. lo strumento (qui, senza intelligenza artificiale): riconosce la specializzazione del destinatario
 *      dal testo dell'annuncio o del sito e decide che cosa valorizzare e che cosa ridurre;
 *   2. il prompt: il CV, il destinatario e queste indicazioni, da incollare su claude.ai (o in un altro
 *      assistente) che riscrive il CV senza inventare nulla.
 *
 * Il testo del CV si salva una volta sola in .job-searcher/cv.txt (resta sul computer).
 */

const cvFile = () => stateDir('cv.txt');

export async function saveCvText(text) {
  await mkdir(path.dirname(cvFile()), { recursive: true });
  await writeFile(cvFile(), text.trim());
}

/** Testo del CV salvato, oppure null. */
export async function loadCvText() {
  try {
    return await readFile(cvFile(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function cvInfo() {
  try {
    const s = await stat(cvFile());
    return { saved: true, updatedAt: s.mtime.toISOString(), chars: s.size };
  } catch {
    return { saved: false };
  }
}

/**
 * Che cosa valorizzare per un destinatario.
 * @param {{ specialties?: string[], kind?: string, text?: string }} target
 * @returns {{ specialties: {id,label}[], focus: string[], downplay: string[] }}
 */
export function emphasisFor({ specialties = [], kind, text = '' }) {
  const ids = specialties.length ? specialties : detectSpecialties(text);
  const chosen = ids.map((id) => SPECIALTIES.find((s) => s.id === id)).filter(Boolean);
  const unique = (list) => [...new Set(list)];
  // Il settore dell'azienda (studio editoriale, agenzia, tipografia…) dice cosa conta di più lì.
  const focus = unique([...(sectorById(kind)?.focus ?? []), ...chosen.flatMap((s) => s.focus)]);
  // Ciò che una specializzazione chiede di ridurre non si riduce se un'altra lo mette in primo piano.
  const downplay = unique(chosen.flatMap((s) => s.downplay)).filter((d) => !focus.includes(d));
  return { specialties: chosen.map(({ id, label }) => ({ id, label })), focus, downplay };
}

const clip = (text, max) => {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
};

/** Descrizione del destinatario per il prompt. */
function describeTarget(target) {
  if (target.type === 'job') {
    const j = target.job;
    return [
      `Mi candido a questa offerta di lavoro:`,
      `- Ruolo: ${j.title}`,
      j.company && `- Azienda: ${j.company}`,
      j.location && `- Luogo: ${j.location}`,
      j.url && `- Annuncio: ${j.url}`,
      j.description
        ? `\nTesto dell'annuncio:\n"""\n${clip(j.description, 3500)}\n"""`
        : "\n(Il testo dell'annuncio non è disponibile: se puoi, aprilo dal link.)",
    ]
      .filter(Boolean)
      .join('\n');
  }
  const p = target.publisher;
  return [
    `Mando una candidatura spontanea a questa azienda (non ha un annuncio aperto):`,
    `- Nome: ${p.name} (${PUBLISHER_KINDS[p.kind] ?? 'casa editrice'})`,
    // Per i settori affini: il legame con il mio profilo e il ruolo che posso proporre.
    !PUBLISHING_SECTORS.includes(p.kind) &&
      sectorById(p.kind) &&
      `- Perché è affine al mio profilo: ${sectorById(p.kind).why}`,
    p.pitch && `- Ruolo che vorrei proporre: ${p.pitch}`,
    !p.pitch &&
      !PUBLISHING_SECTORS.includes(p.kind) &&
      sectorById(p.kind) &&
      `- Ruoli possibili: ${sectorById(p.kind).roles.join(', ')}`,
    p.city && `- Sede: ${p.city}`,
    p.website && `- Sito: ${p.website}`,
    bestContact(p.people) &&
      `- Persona a cui scrivere (dal sito): ${bestContact(p.people).name}, ${bestContact(p.people).role}`,
    p.description && `- Come si descrive: ${clip(p.description, 600)}`,
    p.note && `- Mie note: ${clip(p.note, 400)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Prompt per riscrivere il CV per un destinatario.
 * @param {{ cvText?: string, target: { type: 'job', job } | { type: 'publisher', publisher }, emphasis }} options
 */
export function buildTailorPrompt({ cvText = '', target, emphasis }) {
  const spontaneous = target.type === 'publisher';
  // Azienda di un settore affine: le esperienze vanno raccontate con le parole di quel settore.
  const affine =
    spontaneous && sectorById(target.publisher.kind) && !PUBLISHING_SECTORS.includes(target.publisher.kind);
  const cv = cvText
    ? `Ecco il mio CV attuale (testo estratto dal PDF):\n\n<cv>\n${cvText.trim()}\n</cv>`
    : 'Il mio CV attuale è allegato a questo messaggio.';
  const specialties = emphasis.specialties.length
    ? `Specializzazione riconosciuta: ${emphasis.specialties.map((s) => s.label).join(', ')}.`
    : "Non sono riuscito a riconoscere la specializzazione: deducila dal sito o dall'annuncio, se puoi aprirli, e dimmi quale hai considerato.";
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  return `Aiutami ad adattare il mio CV a una candidatura.

${cv}

${describeTarget(target)}

${specialties}

COSA VALORIZZARE
${emphasis.focus.length ? list(emphasis.focus) : '- ciò che nel CV è più vicino a quello che fa questa azienda'}
${emphasis.downplay.length ? `\nCOSA METTERE IN SECONDO PIANO (senza toglierlo del tutto se è importante per il percorso)\n${list(emphasis.downplay)}\n` : ''}
REGOLE
1. Non inventare nulla: niente esperienze, titoli, date, strumenti o risultati che non siano nel CV. Puoi scegliere, riordinare, accorciare e riformulare.
2. Se per valorizzare un punto ti manca un'informazione (per esempio il tipo di libri curati, il numero di titoli, gli strumenti usati), fammi una domanda invece di supporla.
3. Massimo due pagine. Lingua: ${spontaneous ? 'italiano' : "quella dell'annuncio"}.
4. Tono concreto: verbi d'azione, risultati e responsabilità reali, niente aggettivi vuoti.
${affine ? '5. Non è una casa editrice: racconta le esperienze editoriali con le parole di questo settore (per esempio "correzione di bozze" diventa "controllo di qualità dei testi prima della stampa"), senza cambiarne la sostanza, e spiega nel profilo perché le mie competenze servono qui.\n' : ''}
COSA TI CHIEDO
1. Un profilo iniziale di 3-4 righe pensato per questo destinatario.
2. Le esperienze, con i punti riscritti e ordinati per rilevanza.
3. Le competenze, in ordine di importanza per questo destinatario.
4. Un elenco breve delle modifiche fatte e del perché.
5. ${spontaneous ? 'Una email di candidatura spontanea breve (massimo 150 parole): perché proprio questa azienda, cosa posso offrire, disponibilità a un colloquio; con un oggetto chiaro.' : 'Se te lo chiedo, una lettera di presentazione breve (massimo 250 parole).'}

Scrivi il CV in un formato facile da copiare in un documento (titoli e punti elenco).
`;
}

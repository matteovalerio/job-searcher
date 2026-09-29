import { PUBLISHING_SECTORS, SECTORS } from './sectors.js';
import { PUBLISHER_KINDS, SPECIALTIES } from './specialties.js';
import { normalizeWebsite } from './store.js';

/*
 * Elenchi di case editrici scritti a mano, copiati da un sito o preparati da Claude su claude.ai.
 * Prima di aggiungerle il programma ne visita il sito: una casa editrice inventata o chiusa si nota subito.
 */

/**
 * Testo da incollare su claude.ai per farsi elencare case editrici e studi editoriali di una zona.
 * @param {{ places: string[], radiusKm?: number, known?: string[], interests?: string }} options
 */
export function buildPublishersPrompt({ places, radiusKm = 30, known = [], interests = '' }) {
  const specialties = SPECIALTIES.map((s) => `"${s.id}" (${s.label})`).join(', ');
  return `Sto cercando lavoro in redazione e voglio mandare candidature spontanee. Aiutami a fare un elenco di case editrici e studi editoriali (anche piccoli e indipendenti) con sede a ${places.join(', ')} o entro circa ${radiusKm} km.
${interests ? `\nMi interessano soprattutto: ${interests}.\n` : ''}
REGOLE
1. Solo realtà che esistono davvero e, per quanto sai, sono ancora attive. Niente nomi inventati o supposti.
2. Scrivi il sito solo se sei sicuro dell'indirizzo; altrimenti lascialo vuoto. Controllerò io ogni sito.
3. Includi anche studi e servizi editoriali (redazione, editing, impaginazione per conto di altri editori).
4. Più elementi possibile, ma è meglio un elenco più corto e corretto che uno lungo con errori.
${known.length ? `5. Queste le ho già, non ripeterle: ${known.join(', ')}.\n` : ''}
Rispondi con un blocco \`\`\`json con un array di oggetti così:
[
  {
    "name": "Nome della casa editrice",
    "website": "https://… oppure vuoto",
    "city": "Città",
    "kind": ${PUBLISHING_SECTORS.slice(0, 2)
      .map((k) => `"${k}"`)
      .join(' | ')},
    "specialties": ["uno o più tra: ${SPECIALTIES.map((s) => s.id).join(', ')}"],
    "note": "una riga su cosa pubblicano"
  }
]

Specializzazioni possibili: ${specialties}.
`;
}

/**
 * Testo per claude.ai: dal CV (o dalla descrizione del profilo) Claude individua i settori affini, anche meno
 * ovvi, e propone aziende concrete della zona in cui le competenze del candidato servono.
 * @param {{ candidate: string, hasCv?: boolean, places: string[], radiusKm?: number, suggested?: string[], known?: string[] }} options
 */
export function buildAffinePrompt({ candidate, hasCv = false, places, radiusKm = 30, suggested = [], known = [] }) {
  const affine = SECTORS.filter((s) => !PUBLISHING_SECTORS.includes(s.id));
  const sectorList = affine
    .map(
      (s) =>
        `- "${s.id}", ${s.label}${suggested.includes(s.id) ? ' (tra i più vicini al mio profilo)' : ''}: ${s.why}.`,
    )
    .join('\n');
  const who = hasCv
    ? `Ecco il mio CV (testo estratto dal PDF):\n\n<cv>\n${candidate.trim()}\n</cv>`
    : `Il mio profilo, in breve: ${candidate.trim()}\n(Se ti serve, ti allego il CV.)`;
  return `Sto cercando lavoro e non voglio limitarmi alle offerte con il mio titolo esatto. Aiutami a trovare aziende "affini": settori diversi dal mio in cui le mie competenze servono, anche se lì il ruolo ha un altro nome. Per esempio chi ha lavorato nella redazione di uno studio editoriale può servire a un'agenzia pubblicitaria che impagina cataloghi e libretti per le sagre.

${who}

Zona: ${places.join(', ')} ed entro circa ${radiusKm} km.

COSA TI CHIEDO
1. Elenca le mie competenze trasferibili (quelle che valgono anche fuori dal mio settore), con le parole che usano gli altri settori per chiamarle.
2. Proponi 5-8 settori affini, anche meno ovvi, e per ognuno: perché è affine e che ruolo potrei proporre. Puoi partire da questi, ma aggiungine altri se ha senso:
${sectorList}
3. Per ogni settore elenca aziende concrete della zona (anche piccole) a cui mandare una candidatura spontanea.

REGOLE
- Solo aziende che esistono davvero e, per quanto sai, sono attive. Niente nomi inventati o supposti.
- Scrivi il sito solo se sei sicuro dell'indirizzo; altrimenti lascialo vuoto. Controllerò io ogni sito.
- Meglio un elenco più corto e corretto che uno lungo con errori.
${known.length ? `- Queste le ho già, non ripeterle: ${known.join(', ')}.\n` : ''}
Alla fine, metti le aziende in un blocco \`\`\`json con un array di oggetti così:
[
  {
    "name": "Nome dell'azienda",
    "website": "https://… oppure vuoto",
    "city": "Città",
    "kind": "uno tra: ${affine.map((s) => s.id).join(', ')}, altro",
    "sector": "nome del settore, se kind è altro",
    "pitch": "il ruolo che potrei proporre",
    "why": "una riga: perché le mie competenze servono lì"
  }
]
`;
}

const toPublisher = (item, source) => ({
  name: String(item.name ?? item.nome ?? '').trim(),
  website: normalizeWebsite(item.website ?? item.sito ?? item.url ?? ''),
  city: item.city ?? item.citta ?? item.città ?? null,
  kind: PUBLISHER_KINDS[item.kind] ? item.kind : undefined,
  specialties: Array.isArray(item.specialties)
    ? item.specialties.filter((s) => SPECIALTIES.some((x) => x.id === s))
    : [],
  note: [
    item.note ?? item.nota,
    item.why ?? item.perche,
    item.kind === 'altro' && item.sector && `settore: ${item.sector}`,
  ]
    .filter(Boolean)
    .join(' · '),
  pitch: item.pitch ?? item.ruolo ?? null,
  email: item.email ?? null,
  source,
});

/**
 * Case editrici da un testo: un blocco JSON (per esempio la risposta di Claude) oppure un elenco con una
 * casa editrice per riga, nella forma "Nome", "Nome | sito", "Nome | sito | città" o solo l'indirizzo del sito.
 */
export function parsePublisherList(text) {
  const fenced = [...String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  for (const candidate of [...fenced.reverse(), start >= 0 && end > start ? text.slice(start, end + 1) : null]) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      const list = Array.isArray(value) ? value : value?.publishers;
      if (Array.isArray(list)) return list.map((i) => toPublisher(i, 'claude')).filter((p) => p.name);
    } catch {
      // non è JSON: si prova come elenco semplice
    }
  }
  return String(text)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line && !line.startsWith('```'))
    .map((line) => {
      const [first, ...rest] = line.split(/\s*[|;\t]\s*/);
      const isUrl = (s) => /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(s ?? '');
      if (isUrl(first) && !rest.length) {
        const host = new URL(normalizeWebsite(first)).host.replace(/^www\./, '');
        return toPublisher({ name: host.split('.')[0], website: first }, 'elenco');
      }
      const website = rest.find(isUrl);
      const city = rest.find((s) => s && !isUrl(s));
      return toPublisher({ name: first, website, city }, 'elenco');
    })
    .filter((p) => p.name);
}

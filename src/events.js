import { distanceKm, findComune } from './geo.js';
import { familiesFromText } from './publishers/sectors.js';

/*
 * Fiere, festival e associazioni del settore: nell'editoria contano molto i contatti di persona. Un catalogo
 * curato di appuntamenti che si ripetono ogni anno, con il mese in cui di solito si tengono: le date esatte
 * cambiano e vanno controllate sul sito (il programma non le inventa, propone un promemoria per controllarle).
 *
 *   months   mesi in cui di solito si tiene (1-12)
 *   fit      quanto è vicino a ogni area professionale (vedi profiles/roles.js), come per i settori affini
 *   tips     cosa fare lì per la ricerca di lavoro
 * Il sito si indica solo se è sicuro; altrimenti si cerca il nome.
 */

// biome-ignore format: tabella lunga, più leggibile compatta
export const EVENTS = [
  { id: 'bologna-childrens', name: "Bologna Children's Book Fair", kind: 'fiera', city: 'Bologna', months: [3, 4],
    site: 'https://www.bolognachildrensbookfair.com/', fit: { editoria: 5, grafica: 4, traduzione: 3 },
    about: 'la fiera internazionale dell’editoria per ragazzi: editori, agenti, illustratori e traduttori da tutto il mondo',
    tips: ['giornate professionali: portare CV e biglietti da visita', 'passare agli stand delle case editrici per ragazzi della propria lista', 'seguire gli incontri su traduzione e mestieri del libro'] },
  { id: 'salone-torino', name: 'Salone Internazionale del Libro di Torino', kind: 'fiera', city: 'Torino', months: [5],
    site: 'https://www.salonelibro.it/', fit: { editoria: 5, traduzione: 3, giornalismo: 3 },
    about: 'la più grande fiera del libro italiana, con editori grandi e piccoli',
    tips: ['preparare l’elenco degli stand degli editori a cui candidarsi', 'gli incontri professionali (Salone Off, sezione professionale) sono i più utili per i contatti'] },
  { id: 'piu-libri', name: 'Più libri più liberi', kind: 'fiera', city: 'Roma', months: [12],
    site: 'https://plpl.it/', fit: { editoria: 5, traduzione: 3 },
    about: 'la fiera della piccola e media editoria: gli editori indipendenti, spesso gestiti da poche persone che si incontrano allo stand',
    tips: ['ideale per parlare direttamente con gli editori indipendenti', 'lasciare CV solo dopo una conversazione, non a pioggia'] },
  { id: 'bookcity', name: 'BookCity Milano', kind: 'festival', city: 'Milano', months: [11],
    site: 'https://www.bookcitymilano.it/', fit: { editoria: 4, giornalismo: 3 },
    about: 'una settimana di incontri con autori ed editori in tutta la città',
    tips: ['molti incontri sono organizzati dagli uffici stampa degli editori: buoni per conoscere chi ci lavora'] },
  { id: 'pordenonelegge', name: 'Pordenonelegge', kind: 'festival', city: 'Pordenone', months: [9],
    site: 'https://www.pordenonelegge.it/', fit: { editoria: 4, giornalismo: 3 },
    about: 'festival del libro vicino al Veneto, con molti editori del Nordest',
    tips: ['vicino: si può andare in giornata', 'occasione per conoscere editori e librerie del Nordest'] },
  { id: 'festivaletteratura', name: 'Festivaletteratura', kind: 'festival', city: 'Mantova', months: [9],
    site: 'https://www.festivaletteratura.it/', fit: { editoria: 4, traduzione: 3, giornalismo: 3 },
    about: 'uno dei festival letterari più importanti, raggiungibile in giornata dal Veneto',
    tips: ['cerca volontari ogni anno: un modo per entrare nell’ambiente'] },
  { id: 'incroci-civilta', name: 'Incroci di civiltà', kind: 'festival', city: 'Venezia', months: [4],
    site: null, fit: { traduzione: 5, editoria: 3 },
    about: 'festival di letteratura internazionale a Venezia, con attenzione alla traduzione',
    tips: ['in zona: buono per i contatti con traduttori ed editori veneti'] },
  { id: 'festival-biblico', name: 'Festival Biblico', kind: 'festival', city: 'Vicenza', months: [5],
    site: null, fit: { editoria: 3, giornalismo: 2 },
    about: 'festival di cultura con incontri ed editori, a Vicenza e in altre città venete',
    tips: ['in zona: occasione per incontrare editori del territorio'] },
  { id: 'treviso-comic', name: 'Treviso Comic Book Festival', kind: 'festival', city: 'Treviso', months: [9],
    site: null, fit: { grafica: 5, editoria: 3 },
    about: 'festival del fumetto e dell’illustrazione a Treviso',
    tips: ['utile per chi guarda anche a fumetto, illustrazione e impaginazione'] },
  { id: 'lucca-comics', name: 'Lucca Comics & Games', kind: 'fiera', city: 'Lucca', months: [10, 11],
    site: null, fit: { grafica: 5, editoria: 3, traduzione: 2 },
    about: 'la grande fiera di fumetto e gioco: editori di fumetti, manga e giochi (spesso cercano traduttori e redattori)',
    tips: ['gli editori di fumetti e manga cercano spesso traduttori, adattatori e redattori'] },
  { id: 'microeditoria', name: 'Rassegna della Microeditoria', kind: 'fiera', city: 'Chiari', months: [11],
    site: null, fit: { editoria: 4 },
    about: 'rassegna dei piccolissimi editori, in Lombardia',
    tips: ['editori molto piccoli: si parla direttamente con chi decide'] },
  { id: 'francoforte', name: 'Frankfurter Buchmesse', kind: 'fiera', city: 'Francoforte', country: 'de', months: [10],
    site: 'https://www.buchmesse.de/', fit: { editoria: 4, scientifica: 4, traduzione: 4 },
    about: 'la fiera internazionale dei diritti: editori di tutto il mondo, anche scientifici e accademici',
    tips: ['utile soprattutto per editoria scientifica e internazionale, diritti e traduzione', 'c’è un’area dedicata a carriere e formazione'] },
  { id: 'london-book-fair', name: 'London Book Fair', kind: 'fiera', city: 'Londra', country: 'gb', months: [3],
    site: 'https://www.londonbookfair.co.uk/', fit: { editoria: 4, scientifica: 4, traduzione: 3 },
    about: 'fiera internazionale dei diritti, con molti editori accademici e scientifici',
    tips: ['per chi punta all’editoria scientifica internazionale (Springer Nature, Elsevier, Wiley…)'] },
];

// Associazioni utili: annunci riservati, corsi, elenchi di soci a cui scrivere.
// biome-ignore format: tabella
export const ASSOCIATIONS = [
  { id: 'aie', name: 'AIE – Associazione Italiana Editori', site: 'https://www.aie.it/', fit: { editoria: 5, scientifica: 3 },
    about: 'l’associazione degli editori: l’elenco dei soci è una lista di case editrici a cui candidarsi, e organizza corsi (Scuola per librai e editori, formazione)' },
  { id: 'adei', name: 'ADEI – Associazione degli Editori Indipendenti', site: null, fit: { editoria: 5 },
    about: 'gli editori indipendenti: l’elenco dei soci è una buona lista per candidature spontanee' },
  { id: 'aiti', name: 'AITI – Associazione Italiana Traduttori e Interpreti', site: 'https://aiti.org/', fit: { traduzione: 5 },
    about: 'traduttori e interpreti: formazione, eventi di sezione (anche in Veneto) e contatti' },
  { id: 'strade', name: 'STradE – Sindacato traduttori editoriali', site: null, fit: { traduzione: 5, editoria: 2 },
    about: 'per chi traduce per l’editoria: contratti, compensi, incontri' },
  { id: 'emwa', name: 'EMWA – European Medical Writers Association', site: 'https://www.emwa.org/', fit: { scientifica: 5 },
    about: 'i medical writer europei: corsi, certificazione e una bacheca di offerte di lavoro' },
];

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];
export const monthName = (m) => MONTHS[m - 1];

/** Pertinenza al profilo (più alta = più vicina), come per i settori affini: dalle aree professionali del profilo. */
function relevance(fit, families) {
  const strongest = Math.max(0, ...Object.values(families));
  if (!strongest) return 5;
  const score = Object.entries(fit).reduce((sum, [f, w]) => sum + w * ((families[f] ?? 0) / strongest), 0);
  return Math.round(score * 2);
}

/**
 * Eventi dei prossimi mesi, i più vicini nel tempo prima; in ogni mese prima quelli in zona e più pertinenti.
 * @param {{ profileText?: string, home?: string, now?: Date, months?: number }} options
 *   home: il comune del candidato (per la distanza), months: quanti mesi guardare avanti
 */
export function upcomingEvents({ profileText = '', home = null, now = new Date(), months = 12 } = {}) {
  const families = familiesFromText(profileText);
  const here = home ? findComune(home) : null;
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return EVENTS.map((e) => {
    // Il prossimo mese in cui si tiene (anche questo, se è in corso).
    const ahead = Math.min(...e.months.map((m) => (m - month + 12) % 12));
    const next = ((month - 1 + ahead) % 12) + 1;
    const place = e.country ? null : findComune(e.city);
    return {
      ...e,
      monthsAway: ahead,
      nextMonth: next,
      nextYear: year + (month + ahead > 12 ? 1 : 0),
      when: e.months.map(monthName).join(' o '),
      distanceKm: here && place ? Math.round(distanceKm(here, place)) : null,
      relevance: relevance(e.fit, families),
    };
  })
    .filter((e) => e.monthsAway < months)
    .sort(
      (a, b) =>
        a.monthsAway - b.monthsAway || (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999) || b.relevance - a.relevance,
    );
}

/** Associazioni, le più pertinenti al profilo prima. */
export function associations(profileText = '') {
  const families = familiesFromText(profileText);
  return ASSOCIATIONS.map((a) => ({ ...a, relevance: relevance(a.fit, families) })).sort(
    (a, b) => b.relevance - a.relevance,
  );
}

const icsDate = (y, m, d) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const icsText = (s) =>
  String(s)
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');

/**
 * Promemoria da aggiungere al calendario: il 1° del mese prima dell'evento, "controlla le date di …". Le date
 * dell'evento non si conoscono con certezza, quindi il promemoria non finge di saperle.
 */
export function reminderIcs(event, now = new Date()) {
  let y = event.nextYear;
  let m = event.nextMonth - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  // Se il mese prima è già passato, il promemoria è per domani.
  let day = new Date(Date.UTC(y, m - 1, 1));
  const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (day < tomorrow) day = tomorrow;
  const fmt = (d) => icsDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const start = fmt(day);
  const end = fmt(new Date(day.getTime() + 86400000));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//job-searcher//eventi//IT',
    'BEGIN:VEVENT',
    `UID:${event.id}-${event.nextYear}@job-searcher`,
    `DTSTAMP:${icsDate(now.getFullYear(), now.getMonth() + 1, now.getDate())}T000000Z`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsText(`Controlla le date: ${event.name}`)}`,
    `DESCRIPTION:${icsText(`${event.name} (${event.city}) di solito si tiene a ${event.when}.${event.site ? ` Date e programma: ${event.site}` : ''}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Testo per claude.ai: preparare la visita a un evento (presentazione, domande, chi cercare). */
export function buildEventPrompt(event, { cvText = '', publishers = [] } = {}) {
  const targets = publishers
    .filter((p) => ['da_valutare', 'da_contattare', 'inviata', 'sollecitata'].includes(p.status))
    .slice(0, 25)
    .map((p) => `- ${p.name}${p.city ? ` (${p.city})` : ''}`)
    .join('\n');
  return `Vado a ${event.name} (${event.city}, di solito a ${event.when}): ${event.about}.
Sto cercando lavoro in editoria e voglio usare l'evento per farmi conoscere. Aiutami a prepararmi.

<cv>
${cvText.trim() || '(il CV è allegato a questo messaggio)'}
</cv>

${targets ? `Aziende che mi interessano (dalla mia lista):\n${targets}\n` : ''}
REGOLE
1. Non inventare nulla su di me: usa solo il CV. Se ti manca un'informazione, chiedimela.
2. Non inventare date, espositori o programma dell'evento: se non li sai con certezza, dimmi dove controllarli.

COSA TI CHIEDO
1. Una presentazione di 30 secondi da dire a voce allo stand, in italiano (e una in inglese se l'evento è internazionale).
2. 5 domande intelligenti da fare a un editore o a un redattore, che mostrino che conosco il mestiere.
3. Come riconoscere, tra gli espositori e gli incontri, quelli più utili per me (e quali delle aziende della mia lista potrebbero esserci, da verificare).
4. Cosa portare e come fare seguito dopo l'evento (email entro pochi giorni, che cosa scrivere).
`;
}

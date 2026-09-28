import { readFile } from 'node:fs/promises';
import { findComune } from '../geo.js';
import { compileKeywords, findKeywords, normalize } from '../text.js';
import { LANGUAGE_NAMES, ROLE_FAMILIES, SKILLS } from './roles.js';

/*
 * Lettura di un CV in PDF e ricerca delle informazioni utili a costruire un profilo di ricerca:
 * aree professionali, anni di esperienza, titoli di studio, lingue, competenze e città.
 * È un'analisi a regole, senza servizi esterni: il risultato è una proposta che la procedura guidata
 * fa confermare o correggere al candidato.
 */

/** Estrae il testo di un PDF. */
export async function readCvText(file) {
  let data;
  try {
    data = new Uint8Array(await readFile(file));
  } catch (err) {
    throw new Error(`Impossibile leggere "${file}": ${err.code === 'ENOENT' ? 'file non trovato' : err.message}`);
  }
  const { extractText, getDocumentProxy } = await import('unpdf');
  let text;
  try {
    ({ text } = await extractText(await getDocumentProxy(data), { mergePages: true }));
  } catch (err) {
    throw new Error(`"${file}" non sembra un PDF valido (${err.message})`);
  }
  if (!text.trim()) {
    throw new Error(`Nel PDF "${file}" non c'è testo selezionabile (è una scansione?): usa la modalità interattiva`);
  }
  return text;
}

// Intestazioni delle sezioni di un CV.
const SECTION = {
  experience:
    /^(esperienz[ae]( professional[ei]| lavorativ[ae])?|work experience|professional experience|experience|employment)\b/,
  education: /^(istruzione|formazione|titoli di studio|studi|education)\b/,
  other:
    /^(lingue|conoscenze linguistiche|languages|competenze|skills|capacita|certificazioni|interessi|profilo|profile|summary|pubblicazioni|progetti|riferimenti|dati personali)\b/,
};

/** Divide il CV in sezioni: { experience, education, all } (testo normalizzato). */
export function splitSections(text) {
  const out = { experience: [], education: [], other: [] };
  let current = 'other';
  for (const raw of text.split('\n')) {
    const line = normalize(raw);
    if (!line) continue;
    const heading = line.length <= 45 && Object.entries(SECTION).find(([, re]) => re.test(line));
    if (heading) {
      current = heading[0];
      continue;
    }
    out[current].push(line);
  }
  return { experience: out.experience.join('\n'), education: out.education.join('\n'), all: normalize(text) };
}

const PRESENT = /^(oggi|presente|present|attuale|in corso|current|now|today|ad oggi)$/;
const DATE_RANGE =
  /(?:(\d{1,2})[/.-])?((?:19|20)\d{2})\s*(?:-|–|—|a|to|al)\s*(?:(?:(\d{1,2})[/.-])?((?:19|20)\d{2})|(oggi|presente|present|attuale|in corso|current|now|today|ad oggi))/g;

/** Intervalli di date [inizio, fine] in mesi trovati nel testo. */
export function dateRanges(text, now = new Date()) {
  const nowMonths = now.getFullYear() * 12 + now.getMonth();
  const ranges = [];
  for (const m of text.matchAll(DATE_RANGE)) {
    const start = Number(m[2]) * 12 + (m[1] ? Number(m[1]) - 1 : 0);
    const end = m[5] && PRESENT.test(m[5]) ? nowMonths : Number(m[4]) * 12 + (m[3] ? Number(m[3]) - 1 : 11);
    if (end >= start && end <= nowMonths + 1) ranges.push([start, Math.min(end, nowMonths)]);
  }
  return ranges;
}

const INTERNSHIP = /\b(stage|tirocini[oa]|internship|intern|apprendistato)\b/;

/** Anni di esperienza: somma degli intervalli della sezione "esperienza", senza contare due volte le sovrapposizioni. */
export function yearsOfExperience(experienceText, now = new Date()) {
  // Stage e tirocini non contano come anni di esperienza.
  const lines = experienceText.split('\n').filter((line) => !INTERNSHIP.test(line));
  const ranges = dateRanges(lines.join('\n'), now).sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cursor = -Infinity;
  for (const [start, end] of ranges) {
    const from = Math.max(start, cursor);
    if (end > from) months += end - from;
    cursor = Math.max(cursor, end);
  }
  return Math.round(months / 12);
}

const DEGREES = [
  [/dottorato(?: di ricerca)?(?: in ([a-z' ]{3,40}))?|ph\.?\s?d\.?(?: in ([a-z' ]{3,40}))?/, 'Dottorato'],
  [
    /(?<![\p{L}])master(?!'?s degree)(?: universitario)?(?: di (?:primo|secondo|i|ii) livello)?(?: in ([a-z' ]{3,40}))?/u,
    'Master',
  ],
  [
    /laurea (?:magistrale|specialistica)(?: a ciclo unico)?(?: in ([a-z' ]{3,40}))?|master'?s degree(?: in ([a-z' ]{3,40}))?/,
    'Laurea magistrale',
  ],
  [
    /laurea (?:triennale|di primo livello)(?: in ([a-z' ]{3,40}))?|bachelor'?s degree(?: in ([a-z' ]{3,40}))?/,
    'Laurea triennale',
  ],
  [/diploma (?:di maturita|di scuola superiore)(?: [a-z' ]{3,40})?/, 'Diploma'],
];

/** Titoli di studio: [{ level, field }] */
export function findEducation(text) {
  const out = [];
  for (const [re, level] of DEGREES) {
    const m = text.match(re);
    if (!m) continue;
    const field = (m.slice(1).find(Boolean) ?? '').split(/ (?:presso|at|universita|university|con|voto|\d)/)[0].trim();
    out.push({ level, field });
  }
  return out;
}

const LEVEL =
  /(madrelingua|native|mother tongue|nativo|c2|c1|b2|b1|a2|a1|fluent|ottim[oa]|buon[oa]|discret[oa]|scolastic[oa]|base|basic|advanced|avanzat[oa]|intermedi[oa]|intermediate|professional)/;
const GOOD_LEVEL = /madrelingua|native|mother tongue|nativo|c2|c1|b2|fluent|ottim|buon|advanced|avanzat|professional/;

/** Lingue citate nel CV con il livello, se indicato: [{ name, level, good }] */
export function findLanguages(text) {
  const out = [];
  for (const [name, forms] of Object.entries(LANGUAGE_NAMES)) {
    const re = new RegExp(`(?<![\\p{L}])(${forms.join('|')})(?![\\p{L}])([^\\n]{0,40})`, 'u');
    const m = text.match(re);
    if (!m) continue;
    const level = m[2].match(LEVEL)?.[1] ?? '';
    out.push({ name, level, good: !level || GOOD_LEVEL.test(level) });
  }
  return out;
}

/** Città del candidato: dal CAP ("35121 Padova"), da "residenza"/"domicilio" o dalle prime righe del CV. */
export function findCity(originalText) {
  const lines = originalText.split('\n');
  const candidates = [];
  for (const m of originalText.matchAll(/\b\d{5}\s+([A-ZÀ-Ý][\p{L}'’ -]{1,40}?)(?=\s*(?:\(|,|-|–|\n|$))/gu)) {
    candidates.push(m[1]);
  }
  for (const m of originalText.matchAll(
    /(?:residen\w*|domicili\w*|abito a|vivo a|based in|location)\s*:?\s*([A-ZÀ-Ý][\p{L}'’ ]{2,30})/giu,
  )) {
    candidates.push(m[1]);
  }
  // Nelle prime righe (intestazione) cerchiamo un capoluogo o una città citata tra virgole.
  for (const line of lines.slice(0, 6)) {
    for (const part of line.split(/[,|•·–-]/)) candidates.push(part.replace(/\(\w{2}\)/, '').trim());
  }
  for (const name of candidates) {
    const words = name.trim().split(/\s+/);
    // Proviamo anche a togliere parole in coda: "Padova Italia" -> "Padova".
    for (let n = words.length; n > 0; n--) {
      const comune = words.slice(0, n).join(' ').length >= 3 && findComune(words.slice(0, n).join(' '));
      if (comune) return comune;
    }
  }
  return null;
}

/** Aree professionali presenti nel CV, ordinate per rilevanza. */
export function findFamilies(sections) {
  const scored = [];
  for (const family of ROLE_FAMILIES) {
    const compiled = compileKeywords(family.detect);
    const inExperience = findKeywords(sections.experience, compiled);
    const anywhere = findKeywords(sections.all, compiled);
    // Le parole trovate nelle esperienze lavorative contano di più.
    const score = inExperience.length * 2 + anywhere.length;
    if (anywhere.length) scored.push({ id: family.id, label: family.label, score, evidence: anywhere });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Analizza il testo di un CV.
 * @returns {{ families, years, education, languages, skills, city }}
 */
export function analyzeCv(text, { now = new Date() } = {}) {
  const sections = splitSections(text);
  const experience = sections.experience || sections.all;
  return {
    families: findFamilies(sections),
    years: yearsOfExperience(experience, now),
    education: findEducation(sections.education || sections.all),
    languages: findLanguages(sections.all),
    skills: findKeywords(sections.all, compileKeywords(SKILLS)),
    city: findCity(text),
  };
}

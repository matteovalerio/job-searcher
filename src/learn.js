import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';
import { findComune } from './geo.js';
import { stateDir } from './paths.js';
import { loadProfile } from './profiles/store.js';
import { compileKeywords, findKeywords, normalize } from './text.js';
import { loadLastResults, Tracking } from './tracking.js';

/*
 * Il profilo che impara dalle scelte: le offerte segnate «non mi interessa» e quelle seguite (interessante,
 * candidatura, colloquio…) dicono quali parole dei titoli contano. Da qui nascono proposte, con i numeri:
 *   - esclusione: una parola che compare in molte offerte scartate e in nessuna di quelle seguite;
 *   - bonus: una parola che compare in più offerte seguite e in nessuna scartata.
 * Non si cambia niente da soli: decide chi usa il programma (applica o «no, grazie», che non la ripropone).
 * Le proposte rifiutate stanno in .job-searcher/learn.json.
 */

/** Almeno tante offerte scartate con la stessa parola per proporre di escluderla. */
export const MIN_EXCLUDE = 3;
/** Almeno tante offerte seguite con la stessa parola per proporre il bonus. */
export const MIN_BOOST = 2;

// biome-ignore format: elenco lungo, più leggibile compatto
const STOPWORDS = new Set([
  'a', 'ad', 'al', 'alla', 'alle', 'agli', 'ai', 'con', 'da', 'dal', 'dalla', 'dei', 'del', 'della', 'delle', 'degli',
  'di', 'e', 'ed', 'il', 'in', 'la', 'le', 'lo', 'gli', 'i', 'nel', 'nella', 'per', 'su', 'sul', 'tra', 'fra', 'un',
  'una', 'uno', 'o', 'the', 'and', 'or', 'of', 'for', 'to', 'at', 'with', 'on', 'an', 'as', 'by', 'from', 'm', 'f',
  'mf', 'fm', 'h', 'x', 'w', 'd', 'mwd', 'iii', 'ii', 'anche', 'prima', 'nuovo', 'nuova', 'cercasi', 'cerchiamo',
  'ricerca', 'ricerchiamo', 'hiring', 'job', 'jobs', 'lavoro', 'posizione', 'position', 'role', 'ruolo', 'team',
  'figura', 'profilo', 'risorsa', 'addetto', 'addetta', 'addetti', 'full', 'time', 'part', 'remote', 'remoto',
  'hybrid', 'ibrido', 'sede', 'italia', 'italy', 'europe', 'emea', 'tempo', 'determinato', 'indeterminato',
]);

const words = (title) =>
  normalize(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);

/** Parole (e coppie di parole vicine) di un titolo che possono diventare regole del profilo. */
export function titleTerms(title) {
  const list = words(title);
  const ok = (w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w);
  const terms = new Set(list.filter(ok));
  for (let i = 0; i + 1 < list.length; i++) if (ok(list[i]) && ok(list[i + 1])) terms.add(`${list[i]} ${list[i + 1]}`);
  return [...terms];
}

const POSITIVE = ['interessante', 'candidatura', 'colloquio', 'offerta', 'rifiutata', 'nessuna'];

/** Le parole già usate dal profilo, in qualunque elenco (anche nei target). */
function profileLists(profile) {
  const targets = profile.targets ?? [];
  const all = (field) => [...(profile[field] ?? []), ...targets.flatMap((t) => t[field] ?? [])];
  return {
    keywords: compileKeywords([...all('keywords'), ...all('relatedKeywords')]),
    exclude: compileKeywords(all('excludeKeywords')),
    boost: compileKeywords(all('boostKeywords')),
  };
}

/** Offerte degli ultimi risultati (una volta sola) da un file results-<profilo>.json. */
export const resultJobs = (results) => {
  const seen = new Map();
  for (const t of results?.targets ?? []) for (const j of t.jobs ?? []) seen.set(j.id, j);
  return [...seen.values()];
};

/**
 * Proposte per il profilo a partire dalle scelte.
 * @param {object} opts
 * @param {object[]} opts.tracking   candidature (Tracking.list())
 * @param {object}   opts.profile    profilo di ricerca
 * @param {object[]} [opts.jobs]     offerte degli ultimi risultati: per dire quante ne cambierebbe la proposta
 * @param {string[]} [opts.dismissed] proposte rifiutate ("exclude:commerciale")
 * @returns {{ id, kind: 'exclude'|'boost', term, count, examples: string[], affects: number }[]}
 */
export function suggestFromChoices({ tracking = [], profile = {}, jobs = [], dismissed = [] }) {
  const lists = profileLists(profile);
  const stats = new Map();
  const bump = (term, side, title) => {
    const s = stats.get(term) ?? { pos: [], neg: [] };
    s[side].push(title);
    stats.set(term, s);
  };
  for (const t of tracking) {
    const side = t.status === 'scartata' ? 'neg' : POSITIVE.includes(t.status) ? 'pos' : null;
    if (!side || !t.job?.title) continue;
    for (const term of titleTerms(t.job.title)) bump(term, side, t.job.title);
  }

  const covered = (term, list) => findKeywords(term, list).length > 0;
  // Le offerte già scartate non contano: dai risultati sono già sparite.
  const hidden = new Set(tracking.filter((t) => ['scartata', 'rifiutata'].includes(t.status)).map((t) => t.job?.id));
  const titles = jobs.filter((j) => !hidden.has(j.id)).map((j) => normalize(j.title));
  const out = [];
  for (const [term, { pos, neg }] of stats) {
    const re = compileKeywords([term]);
    const affects = titles.filter((t) => findKeywords(t, re).length).length;
    if (neg.length >= MIN_EXCLUDE && !pos.length) {
      // Una parola chiave del profilo non si esclude: "redattore commerciale" si scarta con "commerciale".
      if (covered(term, lists.keywords) || covered(term, lists.exclude)) continue;
      out.push({ kind: 'exclude', term, count: neg.length, examples: neg.slice(0, 3), affects });
    } else if (pos.length >= MIN_BOOST && !neg.length) {
      if (covered(term, lists.boost) || covered(term, lists.keywords) || covered(term, lists.exclude)) continue;
      out.push({ kind: 'boost', term, count: pos.length, examples: pos.slice(0, 3), affects });
    }
  }

  // Nomi di comuni ("Milano") non sono gusti: la zona si sceglie nei target.
  const filtered = out.filter((s) => !findComune(s.term));
  // Se una coppia di parole copre le stesse offerte di una parola sola, si propone la coppia, più precisa:
  // «social media» invece di «media» (che toglierebbe anche «Media editor»).
  const pairs = filtered.filter((s) => s.term.includes(' '));
  const useful = filtered.filter(
    (s) =>
      s.term.includes(' ') ||
      !pairs.some((p) => p.kind === s.kind && p.count >= s.count && p.term.split(' ').includes(s.term)),
  );
  return useful
    .map((s) => ({ id: `${s.kind}:${s.term}`, ...s }))
    .filter((s) => !dismissed.includes(s.id))
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'exclude' ? -1 : 1) || b.count - a.count || a.term.localeCompare(b.term),
    )
    .slice(0, 12);
}

/** Il profilo con la proposta applicata (una copia: l'originale non cambia). */
export function applySuggestion(profile, suggestion) {
  const field = suggestion.kind === 'exclude' ? 'excludeKeywords' : 'boostKeywords';
  const list = profile[field] ?? [];
  if (list.map(normalize).includes(normalize(suggestion.term))) return profile;
  return { ...profile, [field]: [...list, suggestion.term] };
}

/** Frase che spiega una proposta. */
export function describeSuggestion(s) {
  const examples = s.examples.map((e) => `«${e}»`).join(', ');
  if (s.kind === 'exclude') {
    return {
      title: `Escludere «${s.term}»?`,
      text: `Hai segnato «non mi interessa» ${s.count} offerte con «${s.term}» nel titolo, e nessuna di quelle che segui la contiene (per esempio ${examples}).${s.affects ? ` Negli ultimi risultati ne toglierebbe ${s.affects}.` : ''}`,
    };
  }
  return {
    title: `Dare più punti a «${s.term}»?`,
    text: `Segui ${s.count} offerte con «${s.term}» nel titolo e non ne hai scartata nessuna (per esempio ${examples}).${s.affects ? ` Negli ultimi risultati salirebbero ${s.affects} offerte.` : ''}`,
  };
}

const learnFile = () => stateDir('learn.json');

/** Proposte rifiutate, per profilo. */
export async function loadDismissed(profileId) {
  try {
    return JSON.parse(await readFile(learnFile(), 'utf8')).dismissed?.[profileId] ?? [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function dismissSuggestion(profileId, id) {
  let data = {};
  try {
    data = JSON.parse(await readFile(learnFile(), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  data.dismissed ??= {};
  const list = new Set(data.dismissed[profileId] ?? []);
  list.add(id);
  data.dismissed[profileId] = [...list];
  await writeFileAtomic(learnFile(), `${JSON.stringify(data, null, 2)}\n`);
}

/** Tutto quello che serve per le proposte di un profilo: profilo, candidature, ultimi risultati, rifiuti. */
export async function learnForProfile(profileId) {
  const [profile, tracking, results, dismissed] = await Promise.all([
    loadProfile(profileId),
    new Tracking().load(),
    loadLastResults(profileId),
    loadDismissed(profileId),
  ]);
  const suggestions = suggestFromChoices({ tracking: tracking.list(), profile, jobs: resultJobs(results), dismissed });
  return { profile, suggestions: suggestions.map((s) => ({ ...s, ...describeSuggestion(s) })) };
}

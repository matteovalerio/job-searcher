import { normalize } from '../text.js';
import { JUNIOR_EXCLUDES, LANGUAGE_NAMES, familyById } from './roles.js';
import { slugify } from './store.js';

const unique = (list) => {
  const seen = new Set();
  return list.filter((item) => {
    const key = normalize(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Regioni accettate per le offerte full remote, secondo l'ambito scelto. */
export const REMOTE_SCOPES = {
  italia: { label: 'solo Italia', regions: ['italy', 'italia'], linkedin: ['Italia'] },
  europa: {
    label: 'Italia ed Europa',
    regions: ['italy', 'italia', 'europe', 'european union', 'unione europea', 'eu', 'emea', 'cet'],
    linkedin: ['Italia', 'Unione Europea'],
  },
  mondo: {
    label: 'tutto il mondo',
    regions: [
      'worldwide',
      'anywhere',
      'global',
      'remote',
      'europe',
      'european union',
      'unione europea',
      'eu',
      'emea',
      'cet',
      'italy',
      'italia',
    ],
    linkedin: ['Italia', 'Unione Europea'],
  },
};

/**
 * Proposte per le liste del profilo a partire dalle aree professionali scelte e dall'analisi del CV.
 * @param {string[]} familyIds
 * @param {{ years?: number, skills?: string[], languages?: { name: string, good: boolean }[] }} [cv]
 */
export function suggest(familyIds, cv = {}) {
  const families = familyIds.map(familyById).filter(Boolean);
  const keywords = unique(families.flatMap((f) => f.keywords));
  const covered = (word) => keywords.some((k) => normalize(k).includes(normalize(word)));
  const related = unique(families.flatMap((f) => f.related)).filter((r) => !keywords.includes(r));
  const exclude = unique([
    ...families.flatMap((f) => f.exclude),
    ...((cv.years ?? 0) >= 2 ? JUNIOR_EXCLUDES : []),
  ]).filter((e) => !covered(e)); // non escludere mai parole di un'area scelta ("engineer" per chi è sviluppatore)

  return {
    keywords,
    related,
    exclude,
    boost: unique([...families.flatMap((f) => f.boost), ...(cv.skills ?? [])]),
    searchArea: unique(families.flatMap((f) => f.searchIt)).slice(0, 8),
    searchRemote: unique([
      ...families.flatMap((f) => f.searchIt.slice(0, 2)),
      ...families.flatMap((f) => f.searchEn),
    ]).slice(0, 10),
    languages: unique(['italiano', ...(cv.languages ?? []).filter((l) => l.good).map((l) => l.name)]),
  };
}

/**
 * Filtri proposti in base all'esperienza: niente stage e apprendistato per chi ha già lavorato, e niente
 * offerte che chiedono molti più anni di esperienza di quelli che ha il candidato.
 */
export function suggestFilters(years = 0) {
  if (!years) return undefined;
  return {
    maxYearsRequired: years + 3,
    ...(years >= 2 ? { excludeSeniority: ['stage'], excludeContracts: ['stage', 'apprendistato'] } : {}),
  };
}

/** Forme con cui una lingua compare negli annunci: "inglese" -> ["inglese", "english"]. */
export function languageForms(names) {
  return unique(names.flatMap((n) => LANGUAGE_NAMES[normalize(n)] ?? [normalize(n)]));
}

/**
 * Costruisce il profilo di ricerca (lo stesso formato di profiles/*.json) dalle risposte.
 * @param {object} a  risposte: name, description, keywords, related, exclude, boost, languages, searchArea,
 *                    searchRemote, places, radiusKm, remote ('no'|'italia'|'europa'|'mondo'), maxAgeDays,
 *                    browserSources, candidate
 */
export function buildProfile(a) {
  const targets = [];
  if (a.places?.length) {
    targets.push({
      id: slugify(a.places.join('-')),
      label: `${a.places.join(', ')} e dintorni`,
      type: 'area',
      places: a.places,
      country: 'it',
      radiusKm: a.radiusKm ?? 30,
      searchKeywords: a.searchArea,
    });
  }
  const scope = REMOTE_SCOPES[a.remote];
  if (scope) {
    targets.push({
      id: 'remote',
      label: `Full remote (${scope.label})`,
      type: 'remote',
      searchKeywords: a.searchRemote,
      acceptedRegions: scope.regions,
      linkedinLocations: scope.linkedin,
    });
  }
  if (!targets.length) throw new Error('Serve almeno una zona in cui cercare oppure la ricerca full remote');
  if (!a.keywords?.length) throw new Error('Serve almeno una parola chiave');

  return {
    name: a.name,
    ...(a.description ? { description: a.description } : {}),
    keywords: a.keywords,
    relatedKeywords: a.related ?? [],
    languages: languageForms(a.languages ?? ['italiano']),
    excludeKeywords: a.exclude ?? [],
    boostKeywords: a.boost ?? [],
    ...(a.browserSources ? { enableSources: ['indeed', 'infojobs'] } : {}),
    matchIn: 'title',
    ...(a.filters ? { filters: a.filters } : {}),
    maxAgeDays: a.maxAgeDays ?? 30,
    targets,
    ...(a.candidate ? { candidate: a.candidate } : {}),
    customSources: [],
  };
}

/** Descrizione di una riga del candidato, es. "7 anni di esperienza · Laurea magistrale in linguistica". */
export function describeCandidate(c = {}) {
  return [
    c.years ? `${c.years} anni di esperienza` : '',
    ...(c.education ?? []).map((e) => (e.field ? `${e.level} in ${e.field}` : e.level)),
    c.areas?.length ? `aree: ${c.areas.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

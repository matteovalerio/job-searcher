import { compileKeywords, findKeywords, normalize } from './text.js';

export const DEFAULT_REMOTE_REGIONS = [
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
];

const REMOTE_HINTS = compileKeywords([
  'full remote',
  'fully remote',
  'remote',
  'da remoto',
  'remoto',
  'smart working',
  'telelavoro',
]);

/**
 * Prepara le regole di filtro di un target (parole chiave già compilate).
 * @param {import('./config.js').ResolvedTarget} target
 */
export function buildMatcher(target) {
  return {
    keywords: compileKeywords(target.keywords),
    exclude: compileKeywords(target.excludeKeywords),
    boost: compileKeywords(target.boostKeywords),
    regions: compileKeywords(target.acceptedRegions ?? DEFAULT_REMOTE_REGIONS),
    matchIn: target.matchIn,
    maxAgeDays: target.maxAgeDays,
    remoteOnly: target.type === 'remote',
    minScore: target.minScore ?? 1,
  };
}

/** Motivo per cui un'offerta remota non va bene, oppure null se va bene. */
function remoteProblem(job, matcher, fullText) {
  const remote = job.remote ?? findKeywords(fullText, REMOTE_HINTS).length > 0;
  if (!remote) return 'non remoto';
  const location = normalize(job.location);
  if (!location) return null;
  return findKeywords(location, matcher.regions).length > 0 ? null : `remoto solo per ${job.location}`;
}

/**
 * Valuta un'offerta. Restituisce { score, matched, boosted } oppure { rejected: motivo }.
 * Punteggio: parola chiave nel titolo 10, nella descrizione 2; parola "bonus" nel titolo 5, altrove 2.
 */
export function evaluate(job, matcher, now = Date.now()) {
  const title = normalize(job.title);
  const body = normalize(`${job.description} ${job.tags.join(' ')} ${job.company}`);
  const fullText = `${title} ${body}`;

  if (findKeywords(title, matcher.exclude).length) return { rejected: 'parola esclusa nel titolo' };

  const inTitle = findKeywords(title, matcher.keywords);
  const inBody =
    matcher.matchIn === 'title' ? [] : findKeywords(body, matcher.keywords).filter((k) => !inTitle.includes(k));
  if (!inTitle.length && !inBody.length) return { rejected: 'nessuna parola chiave' };

  if (matcher.maxAgeDays && job.postedAt) {
    const ageDays = (now - Date.parse(job.postedAt)) / 86400000;
    if (ageDays > matcher.maxAgeDays) return { rejected: 'troppo vecchia' };
  }

  if (matcher.remoteOnly) {
    const problem = remoteProblem(job, matcher, fullText);
    if (problem) return { rejected: problem };
  }

  const boostTitle = findKeywords(title, matcher.boost);
  const boostBody = findKeywords(body, matcher.boost).filter((k) => !boostTitle.includes(k));
  const score = inTitle.length * 10 + inBody.length * 2 + boostTitle.length * 5 + boostBody.length * 2;
  if (score < matcher.minScore) return { rejected: 'punteggio basso' };

  return { score, matched: [...inTitle, ...inBody], boosted: [...boostTitle, ...boostBody] };
}

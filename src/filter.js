import { checkDistance, locate } from './geo.js';
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

// Indizi di lavoro da remoto nel testo, per le fonti che non lo dicono esplicitamente.
// "smart working" non basta: in Italia di solito indica un lavoro ibrido.
const REMOTE_HINTS = compileKeywords(['full remote', 'fully remote', 'remote', 'da remoto', 'remoto', 'telelavoro']);

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
    acceptsItaly: (target.acceptedRegions ?? DEFAULT_REMOTE_REGIONS).some((r) =>
      ['italia', 'italy'].includes(normalize(r)),
    ),
    matchIn: target.matchIn,
    maxAgeDays: target.maxAgeDays,
    remoteOnly: target.type === 'remote',
    // Il filtro per distanza vale solo se i luoghi sono stati geolocalizzati (cioè in Italia).
    places: target.type === 'area' && target.places?.every((p) => p.lat !== undefined) ? target.places : null,
    radiusKm: target.radiusKm,
    unknownLocation: target.unknownLocation ?? 'drop',
    minScore: target.minScore ?? 1,
  };
}

/** Motivi di scarto, usati anche per i riepiloghi. */
export const REJECT = {
  excluded: 'parola esclusa nel titolo',
  noKeyword: 'nessuna parola chiave',
  tooOld: 'troppo vecchia',
  notRemote: 'non è full remote',
  region: 'remoto solo per altri paesi',
  farAway: 'fuori zona',
  unknownPlace: 'località non riconosciuta',
  lowScore: 'punteggio basso',
};

/** Motivo per cui un'offerta remota non va bene, oppure null se va bene. */
function remoteProblem(job, matcher, fullText) {
  const remote = job.remote ?? findKeywords(fullText, REMOTE_HINTS).length > 0;
  if (!remote) return REJECT.notRemote;
  const location = normalize(job.location);
  if (!location) return null;
  if (findKeywords(location, matcher.regions).length > 0) return null;
  // Una località italiana ("Milano, Lombardia") va bene se l'Italia è tra le regioni accettate.
  if (matcher.acceptsItaly && locate(job.location)) return null;
  return REJECT.region;
}

function areaProblem(job, matcher) {
  if (!matcher.places) return null;
  const check = checkDistance(job.location, matcher.places, matcher.radiusKm);
  if (check.ok) return null;
  if (check.reason === 'fuori zona') return REJECT.farAway;
  return matcher.unknownLocation === 'keep' ? null : REJECT.unknownPlace;
}

/**
 * Valuta un'offerta. Restituisce { score, matched, boosted } oppure { rejected: motivo }.
 * Punteggio: parola chiave nel titolo 10, nella descrizione 2; parola "bonus" nel titolo 5, altrove 2.
 */
export function evaluate(job, matcher, now = Date.now()) {
  const title = normalize(job.title);
  const body = normalize(`${job.description} ${job.tags.join(' ')} ${job.company}`);
  const fullText = `${title} ${body}`;

  if (findKeywords(title, matcher.exclude).length) return { rejected: REJECT.excluded };

  const inTitle = findKeywords(title, matcher.keywords);
  const inBody =
    matcher.matchIn === 'title' ? [] : findKeywords(body, matcher.keywords).filter((k) => !inTitle.includes(k));
  if (!inTitle.length && !inBody.length) return { rejected: REJECT.noKeyword };

  if (matcher.maxAgeDays && job.postedAt) {
    const ageDays = (now - Date.parse(job.postedAt)) / 86400000;
    if (ageDays > matcher.maxAgeDays) return { rejected: REJECT.tooOld };
  }

  const problem = matcher.remoteOnly ? remoteProblem(job, matcher, fullText) : areaProblem(job, matcher);
  if (problem) return { rejected: problem };

  const boostTitle = findKeywords(title, matcher.boost);
  const boostBody = findKeywords(body, matcher.boost).filter((k) => !boostTitle.includes(k));
  const score = inTitle.length * 10 + inBody.length * 2 + boostTitle.length * 5 + boostBody.length * 2;
  if (score < matcher.minScore) return { rejected: REJECT.lowScore };

  return { score, matched: [...inTitle, ...inBody], boosted: [...boostTitle, ...boostBody] };
}

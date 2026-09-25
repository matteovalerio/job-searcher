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

// Segnali che un'offerta "da remoto" è in realtà ibrida o in sede: non la scartano, ma la segnalano.
const HYBRID_HINTS = compileKeywords(['hybrid', 'ibrido', 'ibrida', 'on-site', 'onsite', 'in office', 'in ufficio']);

// Lingue riconosciute nei titoli ("Hebrew Localization Specialist", "Traduttore tedesco").
// prettier-ignore
const LANGUAGES = compileKeywords([
  'english', 'inglese', 'italian', 'italiano', 'italiana', 'french', 'francese', 'german', 'tedesco', 'tedesca',
  'spanish', 'spagnolo', 'spagnola', 'portuguese', 'portoghese', 'dutch', 'olandese', 'flemish', 'hebrew', 'ebraico',
  'arabic', 'arabo', 'chinese', 'cinese', 'mandarin', 'cantonese', 'japanese', 'giapponese', 'korean', 'coreano',
  'russian', 'russo', 'ukrainian', 'ucraino', 'polish', 'polacco', 'czech', 'ceco', 'slovak', 'slovacco', 'hungarian',
  'ungherese', 'romanian', 'rumeno', 'bulgarian', 'bulgaro', 'greek', 'greco', 'turkish', 'turco', 'swedish',
  'svedese', 'norwegian', 'norvegese', 'danish', 'danese', 'finnish', 'finlandese', 'estonian', 'latvian',
  'lithuanian', 'croatian', 'croato', 'serbian', 'serbo', 'slovenian', 'sloveno', 'kazakh', 'vietnamese', 'thai',
  'hindi', 'bengali', 'urdu', 'persian', 'farsi', 'indonesian', 'malay', 'tagalog', 'swahili', 'catalan', 'catalano',
]);

/**
 * Prepara le regole di filtro di un target (parole chiave già compilate).
 * @param {import('./config.js').ResolvedTarget} target
 */
export function buildMatcher(target) {
  return {
    keywords: compileKeywords(target.keywords),
    related: compileKeywords(target.relatedKeywords ?? []),
    // Se indicate, le offerte che nel titolo chiedono altre lingue vengono scartate.
    languages: target.languages?.length ? target.languages.map(normalize) : null,
    exclude: compileKeywords(target.excludeKeywords),
    boost: compileKeywords(target.boostKeywords),
    regions: compileKeywords(target.acceptedRegions ?? DEFAULT_REMOTE_REGIONS),
    titleRegions: compileKeywords(
      (target.acceptedRegions ?? DEFAULT_REMOTE_REGIONS).filter((r) => !['remote', 'global'].includes(normalize(r))),
    ),
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
  language: "richiede un'altra lingua",
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
  // La regione può essere anche nel titolo: "Medical Editor (EMEA Home Based)". Qui però "remote" e "global"
  // non bastano ("Remote Copy Editor", "Global Head of…" possono essere riservati agli USA).
  if (findKeywords(normalize(job.title), matcher.titleRegions).length > 0) return null;
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
 * Punteggio: parola chiave nel titolo 10, nella descrizione 2; ruolo affine ("relatedKeywords") 5 se nel titolo,
 * altrimenti 1 (una volta sola); parola "bonus" nel titolo 5, altrove 2.
 */
export function evaluate(job, matcher, now = Date.now()) {
  const title = normalize(job.title);
  const body = normalize(`${job.description} ${job.tags.join(' ')} ${job.company}`);
  const fullText = `${title} ${body}`;

  const titleOnly = matcher.matchIn === 'title';
  const inTitle = findKeywords(title, matcher.keywords);
  const inBody = titleOnly ? [] : findKeywords(body, matcher.keywords).filter((k) => !inTitle.includes(k));
  const relTitle = findKeywords(title, matcher.related);
  const relBody = titleOnly ? [] : findKeywords(body, matcher.related).filter((k) => !relTitle.includes(k));
  if (!inTitle.length && !inBody.length && !relTitle.length && !relBody.length) {
    return { rejected: REJECT.noKeyword };
  }

  // Le esclusioni si controllano dopo: così "parola esclusa" indica offerte che altrimenti sarebbero passate.
  if (findKeywords(title, matcher.exclude).length) return { rejected: REJECT.excluded };
  if (matcher.languages) {
    const other = findKeywords(title, LANGUAGES).filter((l) => !matcher.languages.includes(normalize(l)));
    if (other.length) return { rejected: REJECT.language };
  }

  if (matcher.maxAgeDays && job.postedAt) {
    const ageDays = (now - Date.parse(job.postedAt)) / 86400000;
    if (ageDays > matcher.maxAgeDays) return { rejected: REJECT.tooOld };
  }

  const problem = matcher.remoteOnly ? remoteProblem(job, matcher, fullText) : areaProblem(job, matcher);
  if (problem) return { rejected: problem };

  // Una parola già contata come parola chiave non vale di nuovo come "bonus".
  const matched = [...inTitle, ...inBody, ...relTitle, ...relBody].map(normalize);
  const notMatched = (k) => !matched.includes(normalize(k));
  const boostTitle = findKeywords(title, matcher.boost).filter(notMatched);
  const boostBody = findKeywords(body, matcher.boost).filter((k) => notMatched(k) && !boostTitle.includes(k));
  // I ruoli affini contano una volta sola: devono restare sotto i ruoli principali.
  const related = relTitle.length ? 5 : relBody.length ? 1 : 0;
  const score = inTitle.length * 10 + inBody.length * 2 + related + boostTitle.length * 5 + boostBody.length * 2;
  if (score < matcher.minScore) return { rejected: REJECT.lowScore };

  const warnings = [];
  if (matcher.remoteOnly && findKeywords(body, HYBRID_HINTS).length) warnings.push('possibile ibrido');

  return {
    score,
    matched: [...inTitle, ...inBody, ...relTitle, ...relBody],
    boosted: [...boostTitle, ...boostBody],
    warnings,
  };
}

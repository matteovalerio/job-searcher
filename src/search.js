import { dedupe } from './dedupe.js';
import { buildMatcher, evaluate } from './filter.js';
import { missingEnv } from './sources/index.js';

const SOURCE_TIMEOUT_MS = 180000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: tempo scaduto`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Per un'area con più luoghi la fonte viene interrogata una volta per luogo. */
function placeVariants(target) {
  if (target.type !== 'area') return [target];
  return target.places.map((p) => ({ ...target, place: p.name, placeInfo: p }));
}

/**
 * Esegue la ricerca su tutti i target e le fonti di un profilo risolto.
 * Una fonte che fallisce non blocca le altre: l'errore finisce nelle statistiche.
 * Le offerte scartate sono restituite in `rejected`, con il motivo, per capire cosa filtra il programma.
 *
 * @param {{ name: string, targets: import('./config.js').ResolvedTarget[] }} profile
 * @param {{ onProgress?: (event: object) => void, now?: number }} [options]
 */
export async function runSearch(profile, { onProgress = () => {}, now = Date.now() } = {}) {
  const results = [];
  for (const target of profile.targets) {
    const matcher = buildMatcher(target);
    const stats = {};
    const rejected = [];

    const perSource = await Promise.all(
      target.sources.map(async (source) => {
        const missing = missingEnv(source);
        if (missing.length) {
          stats[source.name] = { skipped: `mancano ${missing.join(', ')}` };
          onProgress({ type: 'skip', target, source, reason: stats[source.name].skipped });
          return [];
        }
        onProgress({ type: 'start', target, source });
        const warn = (message) => onProgress({ type: 'warn', target, source, message });
        try {
          const raw = [];
          const errors = [];
          for (const variant of placeVariants(target)) {
            try {
              const found = await withTimeout(
                source.search({
                  keywords: target.queryKeywords,
                  target: variant,
                  maxAgeDays: target.maxAgeDays,
                  maxPages: target.maxPages,
                  warn,
                }),
                SOURCE_TIMEOUT_MS,
                source.label,
              );
              raw.push(...found);
            } catch (err) {
              errors.push(err);
            }
          }
          if (errors.length && !raw.length) throw errors[0];
          for (const err of errors) warn(err.message);

          const kept = [];
          const reasons = {};
          for (const job of raw) {
            const verdict = evaluate(job, matcher, now);
            if (verdict.rejected) {
              reasons[verdict.rejected] = (reasons[verdict.rejected] ?? 0) + 1;
              rejected.push({ ...job, rejected: verdict.rejected });
            } else {
              kept.push({ ...job, ...verdict, targetId: target.id });
            }
          }
          stats[source.name] = { fetched: raw.length, kept: kept.length, reasons };
          onProgress({ type: 'done', target, source, ...stats[source.name] });
          return kept;
        } catch (err) {
          stats[source.name] = { error: err.message };
          onProgress({ type: 'error', target, source, error: err.message });
          return [];
        }
      }),
    );

    const jobs = dedupe(perSource.flat()).sort(
      (a, b) => b.score - a.score || (Date.parse(b.postedAt ?? 0) || 0) - (Date.parse(a.postedAt ?? 0) || 0),
    );
    results.push({ target, jobs, stats, rejected: dedupe(rejected) });
  }
  return results;
}

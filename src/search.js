import { dedupe } from './dedupe.js';
import { buildMatcher, evaluate } from './filter.js';
import { missingEnv } from './sources/index.js';

const SOURCE_TIMEOUT_MS = 120000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: tempo scaduto`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Esegue la ricerca su tutti i target e le fonti di un profilo risolto.
 * Una fonte che fallisce non blocca le altre: l'errore finisce nelle statistiche.
 *
 * @param {{ name: string, targets: import('./config.js').ResolvedTarget[] }} profile
 * @param {{ onProgress?: (event: object) => void, now?: number }} [options]
 */
export async function runSearch(profile, { onProgress = () => {}, now = Date.now() } = {}) {
  const results = [];
  for (const target of profile.targets) {
    const matcher = buildMatcher(target);
    const stats = {};

    const perSource = await Promise.all(
      target.sources.map(async (source) => {
        const missing = missingEnv(source);
        if (missing.length) {
          stats[source.name] = { skipped: `mancano ${missing.join(', ')}` };
          onProgress({ type: 'skip', target, source, reason: stats[source.name].skipped });
          return [];
        }
        onProgress({ type: 'start', target, source });
        try {
          const raw = await withTimeout(
            source.search({
              keywords: target.queryKeywords,
              target,
              maxAgeDays: target.maxAgeDays,
              maxPages: target.maxPages,
              warn: (message) => onProgress({ type: 'warn', target, source, message }),
            }),
            SOURCE_TIMEOUT_MS,
            source.label,
          );
          const kept = [];
          for (const job of raw) {
            const verdict = evaluate(job, matcher, now);
            if (!verdict.rejected) kept.push({ ...job, ...verdict, targetId: target.id });
          }
          stats[source.name] = { fetched: raw.length, kept: kept.length };
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
    results.push({ target, jobs, stats });
  }
  return results;
}

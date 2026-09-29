import { dedupe } from './dedupe.js';
import { buildMatcher, evaluate, REJECT } from './filter.js';
import { missingEnv } from './sources/index.js';

const SOURCE_TIMEOUT_MS = 180000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: tempo scaduto`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Completa fino a `limit` offerte con i dettagli; se una richiesta fallisce si tiene l'offerta com'è.
 * I dettagli già scaricati in una ricerca precedente (cache) non si riscaricano e non contano nel limite.
 */
async function enrichAll(source, jobs, { limit, warn, cache }) {
  const out = [];
  let fetched = 0;
  let failures = 0;
  for (const job of jobs) {
    const known = cache?.get(job.id);
    if (known) {
      out.push({ ...job, description: known.description || job.description, tags: [...job.tags, ...known.tags] });
      continue;
    }
    if (fetched >= limit || failures >= 3) {
      out.push(job);
      continue;
    }
    fetched++;
    try {
      const enriched = await source.enrich(job);
      cache?.set(job.id, { description: enriched.description, tags: enriched.tags.slice(job.tags.length) });
      out.push(enriched);
    } catch (err) {
      failures++;
      if (failures === 3) warn(`dettagli non disponibili (${err.message}): uso solo i titoli`);
      out.push(job);
    }
  }
  return out;
}

const newestFirst = (a, b) => (Date.parse(b.postedAt ?? 0) || 0) - (Date.parse(a.postedAt ?? 0) || 0);

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
export async function runSearch(profile, { onProgress = () => {}, now = Date.now(), cache = null } = {}) {
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
                source.timeoutMs ?? SOURCE_TIMEOUT_MS,
                source.label,
              );
              raw.push(...found);
            } catch (err) {
              errors.push(err);
            }
          }
          if (errors.length && !raw.length) throw errors[0];
          for (const err of errors) warn(err.message);

          let candidates = [];
          const untitled = [];
          const reasons = {};
          const reject = (job, reason) => {
            reasons[reason] = (reasons[reason] ?? 0) + 1;
            rejected.push({ ...job, rejected: reason });
          };
          for (const job of raw) {
            const verdict = evaluate(job, matcher, now);
            // Senza parola chiave nel titolo e senza testo (LinkedIn nei risultati non lo dà): il ruolo può
            // essere nominato nell'annuncio ("Specialista comunicazione" che fa "redazione di testi").
            const readText =
              verdict.rejected === REJECT.noKeyword && source.enrich && matcher.matchIn === 'title' && !job.description;
            if (readText) untitled.push(job);
            else if (verdict.rejected) reject(job, verdict.rejected);
            else candidates.push(job);
          }

          // Alcune fonti (LinkedIn) nei risultati non hanno la descrizione: la scarichiamo per le offerte già
          // passate dal filtro sul titolo, e poi le rivalutiamo.
          if (source.enrich && candidates.length) {
            candidates = await enrichAll(source, dedupe(candidates), { limit: target.maxEnrich ?? 40, warn, cache });
          }
          // Poi, entro un limite, il testo delle più recenti tra quelle che la fonte ha trovato con le nostre parole
          // ma che non le hanno nel titolo. Quelle rimaste senza testo vengono scartate come prima.
          if (untitled.length) {
            const known = new Set(candidates.map((j) => j.id));
            const others = dedupe(untitled)
              .filter((j) => !known.has(j.id))
              .sort(newestFirst);
            candidates.push(...(await enrichAll(source, others, { limit: target.maxEnrichText ?? 30, warn, cache })));
          }

          const kept = [];
          for (const job of candidates) {
            const verdict = evaluate(job, matcher, now);
            if (verdict.rejected) reject(job, verdict.rejected);
            else kept.push({ ...job, ...verdict, targetId: target.id });
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

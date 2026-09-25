/**
 * Esegue in sequenza una ricerca per ciascuna query (es. una per parola chiave) e unisce i risultati.
 * Se alcune query falliscono si tengono i risultati delle altre (segnalando gli errori con `warn`);
 * se falliscono tutte, viene rilanciato solo il primo errore, senza un avviso per ciascuna.
 */
export async function eachQuery(queries, fn, warn = () => {}) {
  const jobs = [];
  let firstError;
  let failures = 0;
  const warnings = [];
  for (const query of queries) {
    try {
      jobs.push(...(await fn(query)));
    } catch (err) {
      failures++;
      firstError ??= err;
      warnings.push(`${JSON.stringify(query)}: ${err.message}`);
    }
  }
  if (queries.length && failures === queries.length) throw firstError;
  warnings.forEach((w) => warn(w));
  return jobs;
}

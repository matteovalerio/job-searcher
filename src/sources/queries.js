/**
 * Esegue in sequenza una ricerca per ciascuna query (es. una per parola chiave) e unisce i risultati.
 * Se alcune query falliscono si tengono i risultati delle altre (segnalando l'errore con `warn`);
 * se falliscono tutte, l'errore viene rilanciato.
 */
export async function eachQuery(queries, fn, warn = () => {}) {
  const jobs = [];
  let firstError;
  let failures = 0;
  for (const query of queries) {
    try {
      jobs.push(...(await fn(query)));
    } catch (err) {
      failures++;
      firstError ??= err;
      warn(`${JSON.stringify(query)}: ${err.message}`);
    }
  }
  if (queries.length && failures === queries.length) throw firstError;
  return jobs;
}

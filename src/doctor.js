import { findComune } from './geo.js';
import { missingEnv } from './sources/index.js';

/*
 * Controllo delle fonti: per ciascuna esegue una ricerca minima (una parola, un luogo, una pagina) e dice se
 * funziona, se non restituisce nulla (spesso segno di un cambiamento del sito) o se va in errore, con un
 * suggerimento su cosa fare.
 */

const TIMEOUT_MS = 90000;

/** Suggerimento leggibile per un errore di una fonte. */
export function hintFor(err, source) {
  const status = err.status;
  if (/playwright|browser|Chrome/i.test(err.message)) return 'installa Chrome oppure imposta JOB_SEARCHER_BROWSER_PATH';
  if (/anti-robot/i.test(err.message)) return 'lancia senza JOB_SEARCHER_HEADLESS e risolvi la verifica nella finestra';
  if ((status === 401 || status === 403) && source.env?.length)
    return `controlla ${source.env.join(' e ')} nel file .env`;
  if (status === 403) return "il sito blocca le richieste automatiche da questa rete: riprova da un'altra connessione";
  if (status === 404 && source.env?.length)
    return `controlla ${source.env.join(' e ')} nel file .env (una chiave sbagliata può dare 404)`;
  if (status === 404) return "l'indirizzo della fonte è cambiato: va aggiornato nel codice o nel profilo";
  if (status === 429) return 'troppe richieste: aspetta qualche minuto e riprova';
  if (status >= 500) return 'il sito ha un problema temporaneo: riprova più tardi';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET'].includes(err.code))
    return 'problema di rete o sito irraggiungibile';
  if (err.code === 'TimeoutError' || /tempo scaduto/.test(err.message)) return 'il sito risponde troppo lentamente';
  return '';
}

/** Target di prova per una fonte: il primo target compatibile del profilo, ridotto al minimo. */
function probeTarget(source, profile) {
  const fromProfile = profile?.targets.find((t) => source.supports.includes(t.type));
  const type = fromProfile?.type ?? (source.supports.includes('area') ? 'area' : 'remote');
  if (type === 'remote') {
    return {
      ...(fromProfile ?? { type: 'remote', id: 'remote', label: 'Full remote' }),
      linkedinLocations: (fromProfile?.linkedinLocations ?? ['Italia']).slice(0, 1),
    };
  }
  const place = fromProfile?.places?.[0] ?? findComune('Padova');
  return {
    ...(fromProfile ?? { type: 'area', id: 'area', radiusKm: 30, country: 'it' }),
    place: place.name,
    placeInfo: place,
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('tempo scaduto')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Controlla le fonti indicate.
 * @param {object[]} sources
 * @param {{ profile?: object, keyword?: string, onResult?: (r: object) => void, timeoutMs?: number }} [options]
 * @returns {Promise<object[]>} un risultato per fonte: { source, status: 'ok'|'empty'|'error'|'skipped', ... }
 */
export async function runDoctor(sources, { profile, keyword, onResult = () => {}, timeoutMs = TIMEOUT_MS } = {}) {
  const results = [];
  for (const source of sources) {
    const result = { source: source.name, label: source.label };
    const missing = missingEnv(source);
    const target = probeTarget(source, profile);
    const word = keyword ?? target.queryKeywords?.[0] ?? profile?.targets[0]?.queryKeywords?.[0] ?? 'editor';
    result.query = `"${word}" ${target.type === 'remote' ? 'full remote' : `a ${target.place}`}`;
    const started = Date.now();
    const warnings = [];
    try {
      if (missing.length) {
        Object.assign(result, {
          status: 'skipped',
          message: `mancano ${missing.join(', ')}`,
          hint: 'vedi .env.example',
        });
      } else {
        const jobs = await withTimeout(
          source.search({ keywords: [word], target, maxAgeDays: 30, maxPages: 1, warn: (w) => warnings.push(w) }),
          timeoutMs,
        );
        result.count = jobs.length;
        result.sample = jobs.slice(0, 2).map((j) => [j.title, j.company, j.location].filter(Boolean).join(' · '));
        result.status = jobs.length ? 'ok' : 'empty';
        if (!jobs.length)
          result.hint = 'nessuna offerta: se succede con parole diverse, il sito potrebbe essere cambiato';
        // Le fonti che scaricano i dettagli (LinkedIn) vanno provate anche su quello.
        if (jobs.length && source.enrich) {
          const detailed = await withTimeout(source.enrich(jobs[0]), timeoutMs).catch((err) => err);
          result.detail =
            detailed instanceof Error
              ? `dettagli non disponibili (${detailed.message})`
              : detailed.description
                ? 'dettagli ok'
                : 'dettagli vuoti: struttura della pagina cambiata?';
        }
      }
    } catch (err) {
      Object.assign(result, { status: 'error', message: err.message, hint: hintFor(err, source) });
    }
    result.warnings = warnings;
    result.seconds = Math.round((Date.now() - started) / 100) / 10;
    results.push(result);
    onResult(result);
  }
  return results;
}

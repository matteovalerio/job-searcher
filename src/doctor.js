import { buildMatcher, evaluate } from './filter.js';
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
  if (/non parte/.test(err.message) && /browser/i.test(err.message)) {
    return "il browser c'è ma non parte: il motivo e la soluzione sono nel messaggio";
  }
  if (/nessun browser|playwright|browser/i.test(err.message)) {
    return 'installa Chrome o Chromium, oppure esegui "npm run browser:install" per scaricare il browser di Playwright';
  }
  if (/formato inatteso/.test(err.message))
    return 'il servizio ha cambiato formato: la fonte va aggiornata (manda questo messaggio)';
  if (/nessuna pagina "lavora con noi"/.test(err.message))
    return 'nessuna pagina trovata: vedi il messaggio per le alternative';
  if (/Certificato del sito incompleto/.test(err.message)) return 'il sito ha un certificato HTTPS configurato male';
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

/** Target di prova per una fonte: un target compatibile del profilo (il primo, o del tipo indicato), ridotto al minimo. */
function probeTarget(source, profile, wantedType) {
  const fromProfile = profile?.targets.find(
    (t) => source.supports.includes(t.type) && (!wantedType || t.type === wantedType),
  );
  const type = fromProfile?.type ?? wantedType ?? (source.supports.includes('area') ? 'area' : 'remote');
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
/** Una ricerca di prova su un target; con un profilo conta anche le offerte che il filtro terrebbe. */
async function probe(source, target, { word, profile, timeoutMs, warnings }) {
  const jobs = await withTimeout(
    source.search({ keywords: [word], target, maxAgeDays: 30, maxPages: 1, warn: (w) => warnings.push(w) }),
    timeoutMs,
  );
  const profileTarget = profile?.targets.find((t) => t.id === target.id);
  const relevant = profileTarget ? jobs.filter((j) => !evaluate(j, buildMatcher(profileTarget)).rejected) : null;
  return { jobs, relevant };
}

/**
 * Nessun risultato: la fonte non funziona o non ci sono offerte per quella parola? Se la fonte cerca per
 * parola chiave si riprova con una parola comunissima; se scarica sempre tutto (feed, pagine) lo si dice.
 */
async function explainEmpty(source, target, { profile, timeoutMs }) {
  if (source.usesKeywords === false) {
    return {
      hint: 'la fonte non ha restituito niente in questo momento (per un Google Alert è normale se non ci sono notizie recenti)',
    };
  }
  const word = source.controlKeyword ?? (target.type === 'remote' ? 'manager' : 'impiegato');
  try {
    const { jobs } = await probe(source, target, { word, profile, timeoutMs, warnings: [] });
    return jobs.length
      ? {
          control: { word, count: jobs.length },
          hint: `la fonte funziona (con "${word}" trova ${jobs.length} offerte): per questa parola semplicemente non c'è niente`,
        }
      : {
          control: { word, count: 0 },
          hint: `nessun risultato neanche con "${word}": probabilmente la fonte non funziona (chiave, indirizzo o parametri)`,
        };
  } catch (err) {
    return { control: { word, error: err.message }, hint: hintFor(err, source) };
  }
}

const describe = (j) => [j.title, j.company, j.location].filter(Boolean).join(' · ');

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
    let target = probeTarget(source, profile);
    const wordFor = (t) => keyword ?? t.queryKeywords?.[0] ?? profile?.targets[0]?.queryKeywords?.[0] ?? 'editor';
    const queryFor = (t) => `"${wordFor(t)}" ${t.type === 'remote' ? 'full remote' : `a ${t.place}`}`;
    result.query = queryFor(target);
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
        let { jobs, relevant } = await probe(source, target, { word: wordFor(target), profile, timeoutMs, warnings });
        // Nessun risultato cercando in zona (spesso parole italiane su un sito internazionale): si riprova col remoto.
        const remote = profile && !jobs.length && target.type === 'area' && probeTarget(source, profile, 'remote');
        if (
          remote?.type === 'remote' &&
          profile.targets.some((t) => t.type === 'remote') &&
          source.supports.includes('remote')
        ) {
          target = remote;
          result.query += `, poi ${queryFor(target)}`;
          ({ jobs, relevant } = await probe(source, target, { word: wordFor(target), profile, timeoutMs, warnings }));
        }
        result.count = jobs.length;
        if (relevant) result.relevant = relevant.length;
        // Come esempio meglio un'offerta pertinente al profilo che una voce qualsiasi.
        result.sample = [...(relevant ?? []), ...jobs].slice(0, 2).map(describe);
        result.status = jobs.length ? 'ok' : 'empty';
        if (!jobs.length) Object.assign(result, await explainEmpty(source, target, { profile, timeoutMs }));
        if (source.resolved?.size) {
          result.pages = [...source.resolved].map(([company, r]) => `${company}: ${r.url} (${r.via})`);
        }
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

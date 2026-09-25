import adzuna from './adzuna.js';
import himalayas from './himalayas.js';
import jobicy from './jobicy.js';
import jooble from './jooble.js';
import linkedin from './linkedin.js';
import remoteok from './remoteok.js';
import remotive from './remotive.js';
import weworkremotely from './weworkremotely.js';
import { createHtmlSource } from './html.js';
import { createRssSource } from './rss.js';

/**
 * Fonti integrate. Per aggiungerne una nuova basta un oggetto con:
 *   name, label, supports (['area'] e/o ['remote']), env (chiavi richieste, opzionale)
 *   async search({ keywords, target, maxAgeDays, maxPages }) -> Job[]  (vedi src/job.js)
 * e registrarlo qui sotto.
 */
export const builtinSources = [linkedin, adzuna, jooble, remotive, remoteok, jobicy, himalayas, weworkremotely];

/** Crea le fonti personalizzate dichiarate nel profilo ("customSources"). */
export function createCustomSource(def) {
  if (!def.name || !def.url) throw new Error('Ogni fonte personalizzata richiede "name" e "url"');
  switch (def.type) {
    case 'rss':
      return createRssSource(def);
    case 'html':
      return createHtmlSource(def);
    default:
      throw new Error(`Tipo di fonte sconosciuto "${def.type}" per "${def.name}" (usa "rss" o "html")`);
  }
}

export function missingEnv(source) {
  return (source.env ?? []).filter((key) => !process.env[key]);
}

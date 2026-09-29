import adzuna from './adzuna.js';
import { createGreenhouseSource, createLeverSource, createSmartRecruitersSource, createWorkdaySource } from './ats.js';
import { createCareersSource } from './careers.js';
import himalayas from './himalayas.js';
import { createHtmlSource } from './html.js';
import indeed from './indeed.js';
import infojobs from './infojobs.js';
import inpa from './inpa.js';
import jobicy from './jobicy.js';
import jooble from './jooble.js';
import linkedin from './linkedin.js';
import remoteok from './remoteok.js';
import remotive from './remotive.js';
import { createRssSource } from './rss.js';
import weworkremotely from './weworkremotely.js';

/**
 * Fonti integrate. Per aggiungerne una nuova basta un oggetto con:
 *   name, label, supports (['area'] e/o ['remote']), env (chiavi richieste, opzionale)
 *   async search({ keywords, target, maxAgeDays, maxPages }) -> Job[]  (vedi src/job.js)
 *   optIn: true         (opz.) usata solo se elencata in "enableSources" o in "sources"
 *   async enrich(job)   (opz.) completa un'offerta già selezionata (es. con la descrizione)
 * e registrarlo qui sotto.
 */
export const builtinSources = [
  linkedin,
  indeed,
  infojobs,
  adzuna,
  jooble,
  inpa,
  remotive,
  remoteok,
  jobicy,
  himalayas,
  weworkremotely,
];

/** Crea le fonti personalizzate dichiarate nel profilo ("customSources"). */
export function createCustomSource(def) {
  if (!def.name) throw new Error('Ogni fonte personalizzata richiede "name"');
  if (['rss', 'html'].includes(def.type) && !def.url) throw new Error(`La fonte "${def.name}" richiede "url"`);
  switch (def.type) {
    case 'rss':
      return createRssSource(def);
    case 'html':
      return createHtmlSource(def);
    case 'careers':
      return createCareersSource(def);
    case 'workday':
      return createWorkdaySource(def);
    case 'greenhouse':
      return createGreenhouseSource(def);
    case 'lever':
      return createLeverSource(def);
    case 'smartrecruiters':
      return createSmartRecruitersSource(def);
    default:
      throw new Error(
        `Tipo di fonte sconosciuto "${def.type}" per "${def.name}" (tipi disponibili: rss, html, careers, workday, greenhouse, lever, smartrecruiters)`,
      );
  }
}

export function missingEnv(source) {
  return (source.env ?? []).filter((key) => !process.env[key]);
}

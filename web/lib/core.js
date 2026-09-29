import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Collegamento con il programma. L'interfaccia web usa gli stessi file della riga di comando (profili,
 * candidature, risultati, .env) e lo stesso codice, che sta nella cartella superiore: lo si carica così
 * com'è in Node, senza farlo impacchettare da Next (import con "turbopackIgnore").
 * Da usare solo nel codice che gira sul server (pagine server e route /api).
 */
const CODE_DIR = path.resolve(process.cwd(), '..');
process.env.JOB_SEARCHER_HOME ??= CODE_DIR;
const envFile = path.join(process.env.JOB_SEARCHER_HOME, '.env');
if (existsSync(envFile) && !globalThis.__jobSearcherEnvLoaded) {
  process.loadEnvFile(envFile);
  globalThis.__jobSearcherEnvLoaded = true;
}

const load = (file) =>
  import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(CODE_DIR, 'src', file)).href);

let modules;
/** I moduli del programma usati dall'interfaccia. */
export async function core() {
  modules ??= Promise.all([
    load('app.js'),
    load('profiles/prompt.js'),
    load('profiles/store.js'),
    load('tracking.js'),
    load('extract.js'),
    load('profiles/cv.js'),
    load('profiles/builder.js'),
    load('profiles/roles.js'),
    load('match.js'),
  ]).then(([app, prompt, store, tracking, extract, cv, builder, roles, match]) => ({
    searchProfile: app.searchProfile,
    checkImported: prompt.checkImported,
    buildPrompt: prompt.buildPrompt,
    extractJson: prompt.extractJson,
    listProfiles: store.listProfiles,
    loadProfile: store.loadProfile,
    saveProfile: store.saveProfile,
    profilePath: store.profilePath,
    slugify: store.slugify,
    readCvData: cv.readCvData,
    analyzeCv: cv.analyzeCv,
    suggest: builder.suggest,
    suggestFilters: builder.suggestFilters,
    buildProfile: builder.buildProfile,
    describeCandidate: builder.describeCandidate,
    detectedFamilies: builder.detectedFamilies,
    REMOTE_SCOPES: builder.REMOTE_SCOPES,
    ROLE_FAMILIES: roles.ROLE_FAMILIES,
    pickJobs: match.pickJobs,
    buildMatchPrompt: match.buildMatchPrompt,
    STATUSES: tracking.STATUSES,
    HIDDEN_STATUSES: tracking.HIDDEN_STATUSES,
    Tracking: tracking.Tracking,
    loadLastResults: tracking.loadLastResults,
    shortId: tracking.shortId,
    describeInfo: extract.describeInfo,
  }));
  return modules;
}

/**
 * Ultimi risultati di un profilo, con lo stato attuale delle candidature (che può essere cambiato dopo la
 * ricerca) e i dati già pronti per la pagina.
 */
export async function resultsForPage(profileId) {
  const { loadLastResults, Tracking, STATUSES, HIDDEN_STATUSES, shortId, describeInfo } = await core();
  const [last, tracking] = await Promise.all([loadLastResults(profileId), new Tracking().load()]);
  if (!last) return null;
  return {
    ...last,
    targets: last.targets.map((t) => ({
      target: t.target,
      stats: t.stats,
      rejectedCount: t.rejected?.length ?? 0,
      jobs: t.jobs
        .map((job) => {
          const tracked = tracking.get(job.id);
          return {
            id: job.id,
            shortId: job.shortId ?? shortId(job),
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            source: job.source,
            postedAt: job.postedAt,
            description: job.description,
            isNew: job.isNew,
            score: job.score,
            // parole del profilo trovate nell'offerta
            tags: [...new Set([...(job.matched ?? []), ...(job.boosted ?? [])])].slice(0, 4),
            info: job.info ?? null,
            infoText: describeInfo(job.info),
            warnings: job.warnings ?? [],
            tracking: tracked ? { status: tracked.status, label: STATUSES[tracked.status], note: tracked.note } : null,
          };
        })
        .filter((job) => !HIDDEN_STATUSES.includes(job.tracking?.status)),
    })),
  };
}

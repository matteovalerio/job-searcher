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
    load('publishers/store.js'),
    load('publishers/discover.js'),
    load('publishers/specialties.js'),
    load('tailor.js'),
    load('publishers/import.js'),
    load('publishers/sectors.js'),
    load('publishers/candidate.js'),
    load('publishers/watch.js'),
    load('market/index.js'),
    load('kit.js'),
    load('config.js'),
    load('diagnose.js'),
    load('kit-store.js'),
    load('plan.js'),
    load('publishers/people.js'),
    load('events.js'),
    load('interview.js'),
  ]).then(
    ([
      app,
      prompt,
      store,
      tracking,
      extract,
      cv,
      builder,
      roles,
      match,
      pubStore,
      discover,
      specialties,
      tailor,
      pubImport,
      sectors,
      candidate,
      watch,
      market,
      kit,
      config,
      diagnose,
      kitStore,
      plan,
      people,
      events,
      interview,
    ]) => ({
      buildInterviewPrep: interview.buildInterviewPrep,
      buildInterviewPrompt: interview.buildInterviewPrompt,
      interviewIcs: interview.interviewIcs,
      profileOfJob: tracking.profileOfJob,
      upcomingEvents: events.upcomingEvents,
      associations: events.associations,
      reminderIcs: events.reminderIcs,
      buildEventPrompt: events.buildEventPrompt,
      findPeople: people.findPeople,
      bestContact: people.bestContact,
      buildPlan: plan.buildPlan,
      loadPlan: plan.loadPlan,
      savePlan: plan.savePlan,
      KitStore: kitStore.KitStore,
      loadTrackingAndKits: kitStore.loadTrackingAndKits,
      resolveProfile: config.resolveProfile,
      diagnoseLinkedin: diagnose.diagnoseLinkedin,
      buildKit: kit.buildKit,
      buildKitPrompt: kit.buildKitPrompt,
      buildFollowUp: kit.buildFollowUp,
      importKitAnswer: kit.importKitAnswer,
      companySiteFromJob: kit.companySiteFromJob,
      findCompany: kit.findCompany,
      cvContacts: kit.cvContacts,
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
      findInLastResults: tracking.findInLastResults,
      Publishers: pubStore.Publishers,
      PUBLISHER_STATUSES: pubStore.PUBLISHER_STATUSES,
      needsFollowUp: pubStore.needsFollowUp,
      discoverPublishers: discover.discoverPublishers,
      checkPublisherSite: discover.checkPublisherSite,
      SPECIALTIES: specialties.SPECIALTIES,
      PUBLISHER_KINDS: specialties.PUBLISHER_KINDS,
      guessKind: specialties.guessKind,
      saveCvText: tailor.saveCvText,
      loadCvText: tailor.loadCvText,
      cvInfo: tailor.cvInfo,
      emphasisFor: tailor.emphasisFor,
      buildTailorPrompt: tailor.buildTailorPrompt,
      buildPublishersPrompt: pubImport.buildPublishersPrompt,
      parsePublisherList: pubImport.parsePublisherList,
      buildAffinePrompt: pubImport.buildAffinePrompt,
      SECTORS: sectors.SECTORS,
      PUBLISHING_SECTORS: sectors.PUBLISHING_SECTORS,
      suggestSectors: sectors.suggestSectors,
      affineSectors: sectors.affineSectors,
      resolveSectors: sectors.resolveSectors,
      candidateText: candidate.candidateText,
      loadWatch: watch.loadWatch,
      saveWatch: watch.saveWatch,
      watchPublishers: watch.watchPublishers,
      describeEvent: watch.describeEvent,
      analyzeMarket: market.analyzeMarket,
      buildMarketPrompt: market.buildMarketPrompt,
      loadHistory: market.loadHistory,
      jobFeatures: market.jobFeatures,
    }),
  );
  return modules;
}

/**
 * Ultimi risultati di un profilo, con lo stato attuale delle candidature (che può essere cambiato dopo la
 * ricerca) e i dati già pronti per la pagina.
 */
export async function resultsForPage(profileId) {
  const { loadLastResults, loadTrackingAndKits, STATUSES, HIDDEN_STATUSES, shortId, describeInfo } = await core();
  // loadTrackingAndKits toglie anche le candidature create solo aprendo un kit (versioni precedenti).
  const [last, { tracking }] = await Promise.all([loadLastResults(profileId), loadTrackingAndKits()]);
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

/** Il piano della settimana (vedi src/plan.js), con candidature, aziende e obiettivi salvati. */
export async function currentPlan() {
  const { loadTrackingAndKits, Publishers, loadPlan, buildPlan } = await core();
  const [{ tracking }, publishers, { goals }] = await Promise.all([
    loadTrackingAndKits(),
    new Publishers().load(),
    loadPlan(),
  ]);
  return buildPlan({ tracking: Object.values(tracking.items), publishers: publishers.items, goals });
}

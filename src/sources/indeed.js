import * as cheerio from 'cheerio';
import path from 'node:path';
import { sleep } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

/*
 * Indeed non ha un'API pubblica e blocca le richieste automatiche (Cloudflare): l'unico modo affidabile
 * è usare un vero browser. Questa fonte apre Chrome tramite Playwright con un profilo salvato in
 * .job-searcher/indeed-browser, così dopo aver superato una volta la verifica "non sono un robot"
 * le esecuzioni successive di solito passano direttamente.
 *
 * È disattivata di default: i termini d'uso di Indeed non consentono la lettura automatica.
 * Si attiva con "enableSources": ["indeed"] nel profilo.
 *
 * Variabili d'ambiente:
 *   INDEED_HOST=it.indeed.com     dominio del paese
 *   INDEED_HEADLESS=1             non mostra la finestra (ma la verifica anti-robot va risolta a mano)
 *   INDEED_BROWSER=chrome         canale Playwright: chrome, msedge, chromium…
 *   INDEED_BROWSER_PATH=…         percorso di un browser Chromium qualsiasi (Brave, Chromium…)
 */

const PAGE_SIZE = 10;
// Filtro "Da remoto" di Indeed (identificatore fisso usato dal sito).
const REMOTE_FILTER = '032b3046-06a3-4876-8dfd-474eb5e7ed11';
// Raggi (km) accettati da Indeed.
const RADII = [0, 5, 10, 15, 25, 35, 50, 100];
const CHALLENGE = /just a moment|un momento|verifica|security check|additional verification|cloudflare/i;

const host = () => process.env.INDEED_HOST || 'it.indeed.com';

export function buildUrl({ keyword, target, maxAgeDays, page = 0 }) {
  const params = new URLSearchParams({ q: keyword });
  if (target.type === 'remote') {
    params.set('l', '');
    params.set('remotejob', REMOTE_FILTER);
  } else {
    params.set('l', target.place);
    params.set('radius', String(RADII.find((r) => r >= (target.radiusKm ?? 25)) ?? 100));
  }
  // Indeed accetta al massimo 14 giorni; oltre, ci pensa il filtro locale sulla data.
  if (maxAgeDays && maxAgeDays <= 14) params.set('fromage', String(maxAgeDays));
  if (page) params.set('start', String(page * PAGE_SIZE));
  params.set('sort', 'date');
  return `https://${host()}/jobs?${params}`;
}

const jobUrl = (jobkey) => `https://${host()}/viewjob?jk=${jobkey}`;

/** Offerte dai dati che la pagina di Indeed incorpora (window.mosaic.providerData["mosaic-provider-jobcards"]). */
export function parseMosaic(data, { remote = null } = {}) {
  const results = data?.metaData?.mosaicProviderJobCardsModel?.results ?? [];
  return results
    .filter((r) => r.jobkey)
    .map((r) =>
      makeJob('indeed', {
        id: r.jobkey,
        title: r.displayTitle ?? r.title,
        company: r.company ?? r.truncatedCompany,
        location: r.formattedLocation ?? r.jobLocationCity,
        url: jobUrl(r.jobkey),
        postedAt: r.pubDate,
        description: r.snippet,
        salary: r.salarySnippet?.text ?? r.extractedSalary?.text ?? '',
        tags: r.jobTypes ?? [],
        remote: r.remoteLocation ? true : remote,
      }),
    );
}

/** Alternativa se i dati incorporati mancano: legge le schede dall'HTML. */
export function parseHtml(html, { remote = null } = {}) {
  const $ = cheerio.load(html);
  return $('a[data-jk]')
    .toArray()
    .map((el) => {
      const link = $(el);
      const card = link.closest('.job_seen_beacon, .cardOutline, li');
      const jobkey = link.attr('data-jk');
      return makeJob('indeed', {
        id: jobkey,
        title: link.find('span[title]').attr('title') || link.text(),
        company: card.find('[data-testid="company-name"], .companyName').first().text(),
        location: card.find('[data-testid="text-location"], .companyLocation').first().text(),
        url: jobUrl(jobkey),
        description: card.find('[data-testid="belowJobSnippet"], .job-snippet').first().text(),
        remote,
      });
    })
    .filter((job) => job.title);
}

async function loadPlaywright() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    throw new Error('manca playwright-core: esegui "npm install"');
  }
}

/** Avvia il browser scelto, altrimenti Chrome, altrimenti il Chromium di Playwright. */
async function launch(chromium, userDataDir, options) {
  if (process.env.INDEED_BROWSER_PATH) {
    return chromium.launchPersistentContext(userDataDir, {
      ...options,
      executablePath: process.env.INDEED_BROWSER_PATH,
    });
  }
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...options,
      channel: process.env.INDEED_BROWSER || 'chrome',
    });
  } catch (err) {
    try {
      // Nessun Chrome installato: prova il Chromium di Playwright (npx playwright install chromium).
      return await chromium.launchPersistentContext(userDataDir, options);
    } catch {
      throw new Error(`impossibile avviare il browser (${err.message.split('\n')[0]}). Installa Chrome.`);
    }
  }
}

/** Apre il browser con profilo persistente. Esportata per poterla sostituire nei test. */
export async function openBrowser() {
  const chromium = await loadPlaywright();
  const headless = ['1', 'true'].includes(process.env.INDEED_HEADLESS ?? '');
  const userDataDir = path.resolve('.job-searcher', 'indeed-browser');
  const options = { headless, viewport: { width: 1280, height: 900 }, locale: 'it-IT' };
  const context = await launch(chromium, userDataDir, options);
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    headless,
    /** Carica una pagina di risultati; se compare la verifica anti-robot aspetta che venga risolta. */
    async load(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const hasJobs = () =>
        page.evaluate(() =>
          Boolean(window.mosaic?.providerData?.['mosaic-provider-jobcards'] || document.querySelector('a[data-jk]')),
        );
      const isEmpty = () =>
        page.evaluate(() => Boolean(document.querySelector('.jobsearch-NoResult, [data-testid="no-results"]')));
      if (!(await hasJobs()) && !(await isEmpty()) && CHALLENGE.test(await page.title())) {
        if (headless) {
          throw new Error('Indeed chiede la verifica anti-robot: esegui una volta senza INDEED_HEADLESS e risolvila');
        }
        process.stderr.write('  Indeed chiede una verifica anti-robot: risolvila nella finestra del browser…\n');
        await page.waitForFunction(
          () => window.mosaic?.providerData?.['mosaic-provider-jobcards'] || document.querySelector('a[data-jk]'),
          null,
          { timeout: 120000 },
        );
      }
      const data = await page.evaluate(() => window.mosaic?.providerData?.['mosaic-provider-jobcards'] ?? null);
      return { data, html: data ? '' : await page.content() };
    },
    close: () => context.close(),
  };
}

export default {
  name: 'indeed',
  label: 'Indeed',
  supports: ['area', 'remote'],
  optIn: true,
  // Pause lunghe tra le pagine e l'eventuale verifica da risolvere a mano richiedono più tempo.
  timeoutMs: 15 * 60 * 1000,
  // Sostituibile nei test.
  openBrowser,
  async search({ keywords, target, maxAgeDays, maxPages = 2, warn }) {
    const browser = await this.openBrowser();
    const remote = target.type === 'remote' ? true : null;
    try {
      return await eachQuery(
        keywords,
        async (keyword) => {
          const jobs = [];
          for (let page = 0; page < maxPages; page++) {
            const { data, html } = await browser.load(buildUrl({ keyword, target, maxAgeDays, page }));
            const found = data ? parseMosaic(data, { remote }) : parseHtml(html, { remote });
            jobs.push(...found);
            // Pause lunghe e irregolari: Indeed è molto sensibile al traffico automatico.
            await sleep(3000 + Math.random() * 3000);
            if (found.length < PAGE_SIZE) break;
          }
          return jobs;
        },
        warn,
      );
    } finally {
      await browser.close();
    }
  },
};

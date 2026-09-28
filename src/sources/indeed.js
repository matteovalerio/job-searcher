import * as cheerio from 'cheerio';
import { openBrowser, saveDebugPage } from '../browser.js';
import { sleep } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

/*
 * Indeed non ha un'API pubblica e blocca le richieste automatiche (Cloudflare): l'unico modo affidabile
 * è usare un vero browser (vedi src/browser.js).
 *
 * È disattivata di default: i termini d'uso di Indeed non consentono la lettura automatica.
 * Si attiva con "enableSources": ["indeed"] nel profilo. INDEED_HOST=it.indeed.com cambia il dominio.
 */

const PAGE_SIZE = 10;
// Filtro "Da remoto" di Indeed (identificatore fisso usato dal sito).
const REMOTE_FILTER = '032b3046-06a3-4876-8dfd-474eb5e7ed11';
// Raggi (km) accettati da Indeed.
const RADII = [0, 5, 10, 15, 25, 35, 50, 100];

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

export default {
  name: 'indeed',
  label: 'Indeed',
  supports: ['area', 'remote'],
  optIn: true,
  // Pause lunghe tra le pagine e l'eventuale verifica da risolvere a mano richiedono più tempo.
  timeoutMs: 15 * 60 * 1000,
  // Sostituibili nei test.
  openBrowser,
  saveDebugPage,
  async search({ keywords, target, maxAgeDays, maxPages = 2, warn }) {
    const browser = await this.openBrowser();
    const remote = target.type === 'remote' ? true : null;
    try {
      return await eachQuery(
        keywords,
        async (keyword) => {
          const jobs = [];
          for (let page = 0; page < maxPages; page++) {
            await browser.load(buildUrl({ keyword, target, maxAgeDays, page }), {
              site: 'Indeed',
              ready: () =>
                Boolean(
                  window.mosaic?.providerData?.['mosaic-provider-jobcards'] || document.querySelector('a[data-jk]'),
                ),
              empty: () => Boolean(document.querySelector('.jobsearch-NoResult, [data-testid="no-results"]')),
            });
            const data = await browser.evaluate(
              () => window.mosaic?.providerData?.['mosaic-provider-jobcards'] ?? null,
            );
            const html = data ? '' : await browser.content();
            const found = data ? parseMosaic(data, { remote }) : parseHtml(html, { remote });
            if (!found.length && page === 0 && !data) {
              warn(`nessuna offerta riconosciuta: pagina salvata in ${await this.saveDebugPage('indeed', html)}`);
            }
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

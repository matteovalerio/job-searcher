import * as cheerio from 'cheerio';
import { getText, sleep } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

// Endpoint pubblico (senza login) usato dalla pagina "Offerte di lavoro" di LinkedIn.
const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGE_SIZE = 25;
// LinkedIn accetta solo questi raggi, in miglia.
const MILES = [5, 10, 25, 50, 100];

// Codici geografici LinkedIn: senza, il testo della località può essere interpretato male.
const GEO_IDS = {
  italia: '103350119',
  italy: '103350119',
  'unione europea': '91000000',
  'european union': '91000000',
  worldwide: '92000000',
};

/** Località da passare a LinkedIn: "Padova, Veneto, Italia" è riconosciuta meglio di "Padova". */
export function linkedinLocation(target) {
  const info = target.placeInfo;
  return info?.region ? `${info.name}, ${info.region.split('/')[0]}, Italia` : target.place;
}

export function kmToLinkedinMiles(km) {
  const miles = km / 1.609;
  return MILES.find((m) => m >= miles) ?? 100;
}

/** Estrae le offerte dall'HTML restituito da LinkedIn. */
export function parse(html, { remote = null } = {}) {
  const $ = cheerio.load(html);
  return $('.base-card, .job-search-card')
    .toArray()
    .map((el) => {
      const card = $(el);
      const link = card.find('a.base-card__full-link, a[href*="/jobs/view/"]').first().attr('href') ?? '';
      const urn = card.attr('data-entity-urn') ?? card.find('[data-entity-urn]').attr('data-entity-urn') ?? '';
      return makeJob('linkedin', {
        id: urn.split(':').pop() || link.split('?')[0],
        title: card.find('.base-search-card__title').text(),
        company: card.find('.base-search-card__subtitle').text(),
        location: card.find('.job-search-card__location').text(),
        url: link.split('?')[0],
        postedAt: card.find('time').attr('datetime'),
        salary: card.find('.job-search-card__salary-info').text(),
        remote,
      });
    })
    .filter((job) => job.title && job.url);
}

export default {
  name: 'linkedin',
  label: 'LinkedIn',
  supports: ['area', 'remote'],
  async search({ keywords, target, maxAgeDays, maxPages = 2, warn }) {
    // Per il remoto interroghiamo più "località" LinkedIn con il filtro "Da remoto" (f_WT=2).
    const locations =
      target.type === 'remote'
        ? (target.linkedinLocations ?? ['Italia', 'Unione Europea', 'Worldwide'])
        : [linkedinLocation(target)];
    const queries = keywords.flatMap((keyword) => locations.map((location) => ({ keyword, location })));
    return eachQuery(
      queries,
      async ({ keyword, location }) => {
        const jobs = [];
        for (let page = 0; page < maxPages; page++) {
          const params = new URLSearchParams({ keywords: keyword, location, start: String(page * PAGE_SIZE) });
          const geoId = GEO_IDS[location.toLowerCase()] ?? target.linkedinGeoId;
          if (geoId) params.set('geoId', geoId);
          if (target.type === 'remote') params.set('f_WT', '2');
          else params.set('distance', String(kmToLinkedinMiles(target.radiusKm ?? 30)));
          if (maxAgeDays) params.set('f_TPR', `r${maxAgeDays * 86400}`);
          const html = await getText(`${BASE}?${params}`);
          const found = parse(html, { remote: target.type === 'remote' ? true : null });
          jobs.push(...found);
          await sleep(1500); // LinkedIn limita rapidamente chi fa troppe richieste
          if (found.length < PAGE_SIZE) break;
        }
        return jobs;
      },
      warn,
    );
  },
};

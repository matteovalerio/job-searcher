import * as cheerio from 'cheerio';
import { openBrowser, saveDebugPage } from '../browser.js';
import { sleep } from '../http.js';
import { makeJob } from '../job.js';
import { fillTemplate } from '../text.js';
import { parseJsonLd } from './jsonld.js';
import { eachQuery } from './queries.js';

/*
 * InfoJobs Italia non ha un'API pubblica e protegge il sito dagli script: come per Indeed si usa un vero
 * browser (vedi src/browser.js). È disattivata di default; si attiva con "enableSources": ["infojobs"].
 *
 * L'indirizzo della ricerca si può cambiare senza toccare il codice, con INFOJOBS_SEARCH_URL o con
 * "infojobsUrl" nel target: fai una ricerca sul sito (es. "redattore" a "Padova"), copia l'indirizzo e
 * sostituisci la parola cercata con {keyword} e la località con {place}.
 *
 * Le offerte si riconoscono in tre modi, dal più al meno affidabile: dati strutturati JSON-LD, dati della
 * pagina (__NEXT_DATA__) e, in mancanza, i link alle schede delle offerte.
 */

export const DEFAULT_URL = 'https://www.infojobs.it/offerte-lavoro?keyword={keyword}&location={place}';
// I link alle offerte di InfoJobs finiscono con un codice tipo "of-i1a2b3c…".
const OFFER_LINK = /\/of-[a-z0-9]{6,}|\/offerta(?:-lavoro)?\/|\/job\//i;

export function buildUrl({ keyword, target }) {
  const template = target.infojobsUrl || process.env.INFOJOBS_SEARCH_URL || DEFAULT_URL;
  return fillTemplate(template, { keyword, place: target.place ?? '', radiusKm: target.radiusKm ?? '' });
}

const text = (v) => (typeof v === 'string' ? v : (v?.name ?? v?.label ?? v?.value ?? ''));

/**
 * Offerte dai dati della pagina (__NEXT_DATA__): cerca oggetti con un titolo e un link o un identificativo
 * dell'offerta, oltre a una località o un'azienda.
 */
export function parseNextData($, baseUrl) {
  const raw = $('script#__NEXT_DATA__').text();
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const title = node.title ?? node.jobTitle;
    const link = node.link ?? node.url ?? node.offerUrl;
    const company = text(node.company ?? node.companyName ?? node.author);
    const location = text(node.city ?? node.location ?? node.province ?? node.cityName);
    if (typeof title === 'string' && (link || node.id) && (company || location)) {
      const url = link ? new URL(link, baseUrl).href : '';
      const key = url || node.id;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          id: node.id ?? url,
          title,
          company,
          location,
          url,
          postedAt: node.published ?? node.publishedAt ?? node.updated ?? node.date,
          description: node.description ?? node.requirementMin ?? '',
          remote: /teletrabajo|telelavoro|remote|remoto/i.test(text(node.teleworking)) || null,
        });
      }
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(data, 0);
  return out;
}

/** Ultima risorsa: i link alle schede delle offerte e il testo intorno. */
export function parseLinks($, baseUrl) {
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    if (!OFFER_LINK.test(href)) return;
    const url = new URL(href, baseUrl).href.split('?')[0];
    const title = (a.attr('title') || a.text()).replace(/\s+/g, ' ').trim();
    if (seen.has(url) || title.length < 3) return;
    seen.add(url);
    const card = a.closest('li, article, [class*="card"], [class*="offer"], [class*="item"]');
    const field = (pattern) =>
      card
        .find('*')
        .filter((_, e) => pattern.test($(e).attr('class') ?? '') && $(e).children().length === 0)
        .first()
        .text()
        .trim();
    out.push({
      id: url,
      title,
      company: field(/company|azienda|empresa|employer/i),
      location: field(/location|city|citta|province|provincia|localita|place/i),
      url,
      postedAt: card.find('time').attr('datetime') ?? '',
      description: field(/description|descrizione|snippet|requirement/i),
      remote: null,
    });
  });
  return out;
}

export function parse(html, baseUrl) {
  const $ = cheerio.load(html);
  for (const strategy of [parseJsonLd, parseNextData, parseLinks]) {
    const items = strategy($, baseUrl).filter((i) => i.title);
    if (items.length) return items.map((i) => makeJob('infojobs', i));
  }
  return [];
}

export default {
  name: 'infojobs',
  label: 'InfoJobs',
  supports: ['area'],
  optIn: true,
  browser: true,
  timeoutMs: 15 * 60 * 1000,
  // Sostituibili nei test.
  openBrowser,
  saveDebugPage,
  async search({ keywords, target, warn }) {
    const browser = await this.openBrowser();
    try {
      return await eachQuery(
        keywords,
        async (keyword) => {
          const url = buildUrl({ keyword, target });
          await browser.load(url, {
            site: 'InfoJobs',
            ready: () =>
              Boolean(
                document.querySelector('script[type="application/ld+json"], script#__NEXT_DATA__') ||
                  [...document.querySelectorAll('a[href]')].some((a) => /\/of-[a-z0-9]{6,}/i.test(a.href)),
              ),
          });
          const html = await browser.content();
          const jobs = parse(html, url);
          if (!jobs.length && keyword === keywords[0]) {
            warn(`nessuna offerta riconosciuta: pagina salvata in ${await this.saveDebugPage('infojobs', html)}`);
          }
          await sleep(3000 + Math.random() * 3000);
          return jobs;
        },
        warn,
      );
    } finally {
      await browser.close();
    }
  },
};

import * as cheerio from 'cheerio';
import { getText } from '../http.js';
import { makeJob } from '../job.js';
import { fillTemplate } from '../text.js';
import { eachQuery } from './queries.js';

/** Legge un feed RSS 2.0 o Atom e restituisce gli elementi grezzi. */
export function parseFeed(xml) {
  const $ = cheerio.load(xml, { xml: true });
  return $('item, entry')
    .toArray()
    .map((el) => {
      const item = $(el);
      const field = (...names) => {
        for (const name of names) {
          const text = item.children(name).first().text().trim();
          if (text) return text;
        }
        return '';
      };
      const link = item.children('link').first();
      return {
        title: field('title'),
        link: link.attr('href') || link.text().trim() || field('guid'),
        guid: field('guid', 'id'),
        date: field('pubDate', 'published', 'updated', 'dc\\:date'),
        description: field('description', 'summary', 'content', 'content\\:encoded'),
        company: field('company', 'author name', 'dc\\:creator'),
        location: field('region', 'location', 'job_listing\\:location'),
      };
    });
}

/**
 * Crea una fonte da un feed RSS/Atom. Nell'URL si possono usare {keyword}, {place}, {radiusKm}:
 * se manca {keyword} il feed viene scaricato una sola volta e filtrato in locale.
 */
export function createRssSource({ name, label, url, supports = ['area', 'remote'], remote = null, mapItem }) {
  const toJob = (item) =>
    makeJob(name, {
      id: item.guid || item.link,
      title: item.title,
      company: item.company,
      location: item.location,
      url: item.link,
      postedAt: item.date,
      description: item.description,
      remote,
      ...mapItem?.(item),
    });
  return {
    name,
    label: label ?? name,
    supports,
    async search({ keywords, target, warn }) {
      const perKeyword = url.includes('{keyword}');
      return eachQuery(
        perKeyword ? keywords : [null],
        async (keyword) => {
          const feedUrl = fillTemplate(url, { keyword, place: target.place, radiusKm: target.radiusKm });
          return parseFeed(await getText(feedUrl)).map(toJob);
        },
        warn,
      );
    },
  };
}

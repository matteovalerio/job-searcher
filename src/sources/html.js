import * as cheerio from 'cheerio';
import { getText } from '../http.js';
import { makeJob } from '../job.js';
import { fillTemplate } from '../text.js';
import { eachQuery } from './queries.js';

/**
 * Legge un campo da un elemento: "selettore" prende il testo, "selettore@attributo" l'attributo.
 * Il selettore vuoto ("@href") indica l'elemento stesso.
 */
function readField($, el, spec) {
  if (!spec) return '';
  const [selector, attr] = spec.split('@');
  const node = selector ? $(el).find(selector).first() : $(el);
  return (attr ? node.attr(attr) : node.text())?.trim() ?? '';
}

export function parseHtml(html, { selectors, baseUrl }) {
  const $ = cheerio.load(html);
  return $(selectors.item)
    .toArray()
    .map((el) => {
      const link = readField($, el, selectors.link ?? 'a@href');
      return {
        title: readField($, el, selectors.title),
        url: link ? new URL(link, baseUrl).href : '',
        company: readField($, el, selectors.company),
        location: readField($, el, selectors.location),
        postedAt: readField($, el, selectors.date),
        description: readField($, el, selectors.description),
      };
    });
}

/**
 * Crea una fonte che legge una pagina di risultati di un sito qualunque tramite selettori CSS.
 * Vedi il README per un esempio di configurazione.
 */
export function createHtmlSource({ name, label, url, selectors, supports = ['area', 'remote'], remote = null }) {
  if (!selectors?.item || !selectors?.title) {
    throw new Error(`La fonte html "${name}" richiede almeno selectors.item e selectors.title`);
  }
  return {
    name,
    label: label ?? name,
    supports,
    async search({ keywords, target, warn }) {
      const perKeyword = url.includes('{keyword}');
      return eachQuery(
        perKeyword ? keywords : [null],
        async (keyword) => {
          const pageUrl = fillTemplate(url, { keyword, place: target.place, radiusKm: target.radiusKm });
          const items = parseHtml(await getText(pageUrl), { selectors, baseUrl: pageUrl });
          return items.filter((i) => i.title).map((i) => makeJob(name, { ...i, id: i.url, remote }));
        },
        warn,
      );
    },
  };
}

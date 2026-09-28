import * as cheerio from 'cheerio';
import { getText } from '../http.js';
import { makeJob } from '../job.js';
import { parseJsonLd } from './jsonld.js';
import { eachQuery } from './queries.js';

/*
 * Pagine "lavora con noi" delle aziende (per esempio le case editrici), che spesso pubblicano le offerte
 * solo sul proprio sito. Basta indicare il sito: se l'indirizzo non è già la pagina delle offerte, il
 * programma cerca nella home il link "Lavora con noi" / "Careers" e lo segue.
 *
 * Dalla pagina si prendono le offerte strutturate (JSON-LD) se ci sono, altrimenti titoli e link: il testo
 * di menu e piè di pagina viene poi scartato dal filtro sulle parole chiave del profilo, che guarda il titolo.
 *
 *   { "type": "careers", "name": "editori", "label": "Case editrici",
 *     "pages": [{ "company": "Piccin", "url": "https://www.piccin.it", "location": "Padova" }] }
 */

const CAREERS_LINK =
  /lavora[\s-]con[\s-]noi|lavora[\s-]con[\s-]me|careers?|carriere|opportunit[aà]|posizioni[\s-]aperte|offerte[\s-]di[\s-]lavoro|work[\s-]with[\s-]us|join[\s-]us|jobs?\b|recruiting|candidature/i;
// Elementi che quasi mai contengono offerte.
const NOISE =
  'nav, header, footer, script, style, noscript, form, [role="navigation"], .cookie, #cookie, [class*="cookie"]';

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** Link alla pagina delle offerte trovato nella home, oppure null. */
export function findCareersLink(html, baseUrl) {
  const $ = cheerio.load(html);
  const host = new URL(baseUrl).host;
  const links = $('a[href]')
    .toArray()
    .map((el) => ({ text: clean($(el).text()), href: $(el).attr('href') }))
    .filter(({ text, href }) => CAREERS_LINK.test(text) || CAREERS_LINK.test(href))
    .map(({ href }) => {
      try {
        return new URL(href, baseUrl);
      } catch {
        return null;
      }
    })
    .filter((u) => u && /^https?:$/.test(u.protocol));
  // Meglio un link dello stesso sito; i siti esterni (piattaforme di selezione) vanno bene lo stesso.
  const best = links.find((u) => u.host === host) ?? links[0];
  return best ? best.href : null;
}

/** Possibili offerte in una pagina: JSON-LD, altrimenti link e titoli del contenuto principale. */
export function parseCareersPage(html, baseUrl) {
  const $ = cheerio.load(html);
  const structured = parseJsonLd($, baseUrl);
  if (structured.length) return structured;

  $(NOISE).remove();
  const seen = new Set();
  const items = [];
  const add = (title, url) => {
    const t = clean(title);
    if (t.length < 4 || t.length > 140 || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    items.push({ title: t, url });
  };
  $('main a[href], article a[href], body a[href]').each((_, el) => {
    const a = $(el);
    let url;
    try {
      url = new URL(a.attr('href'), baseUrl).href;
    } catch {
      return;
    }
    if (/^mailto:|^tel:|^javascript:/i.test(a.attr('href'))) return;
    add(a.attr('title') || a.text(), url);
  });
  // Titoli senza link (offerte descritte direttamente nella pagina): si rimanda alla pagina stessa.
  $('h1, h2, h3, h4, li > strong, p > strong').each((_, el) => add($(el).text(), baseUrl));
  return items;
}

export function createCareersSource({ name, label, pages = [], supports = ['area', 'remote'], remote = null }) {
  if (!pages.length) throw new Error(`La fonte "${name}" richiede almeno una pagina in "pages"`);
  // La stessa pagina serve a tutti i target e a tutti i luoghi: la si scarica una volta per esecuzione.
  const cache = new Map();
  const fetchPage = async (page) => {
    if (!cache.has(page.url)) {
      cache.set(
        page.url,
        (async () => {
          let url = page.url;
          let html = await getText(url);
          if (!CAREERS_LINK.test(new URL(url).pathname)) {
            const link = findCareersLink(html, url);
            if (!link) throw new Error(`${page.company}: nessun link "lavora con noi" nella pagina ${url}`);
            url = link;
            html = await getText(url);
          }
          return parseCareersPage(html, url);
        })(),
      );
    }
    return cache.get(page.url);
  };

  return {
    name,
    label: label ?? name,
    supports,
    async search({ warn }) {
      return eachQuery(
        pages,
        async (page) =>
          (await fetchPage(page)).map((item) =>
            makeJob(name, {
              ...item,
              company: item.company || page.company,
              location: item.location || page.location || '',
              id: `${page.company}:${item.url}#${item.title}`,
              remote: item.remote ?? page.remote ?? remote,
            }),
          ),
        warn,
      );
    },
  };
}

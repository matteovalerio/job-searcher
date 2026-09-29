import * as cheerio from 'cheerio';
import { getText } from '../http.js';
import { makeJob } from '../job.js';
import { parseJsonLd } from './jsonld.js';

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

// Indizi di una pagina delle offerte, dal più affidabile al meno.
const CAREERS_PATTERNS = [
  /lavora[\s_-]*con[\s_-]*noi|careers?\b|carriere|posizioni[\s_-]aperte|offerte[\s_-]di[\s_-]lavoro|work[\s_-]with[\s_-]us|job[\s_-]opportunit/i,
  /\bjobs?\b|join[\s_-]us|recruiting|selezione[\s_-]del[\s_-]personale|lavora[\s_-]con[\s_-]me/i,
  /opportunit[aà][\s_-]di[\s_-]lavoro|candidature?[\s_-]spontane[ae]|invia[\s_-]il[\s_-]tuo[\s_-]cv/i,
];
const careersRank = (text) => {
  const i = CAREERS_PATTERNS.findIndex((re) => re.test(text));
  return i < 0 ? Infinity : i;
};
// Indirizzi tipici provati se la pagina non si trova né dai link né dalla mappa del sito.
const COMMON_PATHS = [
  '/lavora-con-noi',
  '/lavora-con-noi/',
  '/chi-siamo/lavora-con-noi',
  '/azienda/lavora-con-noi',
  '/it/lavora-con-noi',
  '/careers',
  '/carriere',
  '/jobs',
  '/work-with-us',
];
// Elementi che quasi mai contengono offerte.
const NOISE =
  'nav, header, footer, script, style, noscript, form, [role="navigation"], .cookie, #cookie, [class*="cookie"]';

const clean = (s) => s.replace(/\s+/g, ' ').trim();

const toUrl = (href, base) => {
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
};

/** Link alla pagina delle offerte trovato in una pagina (di solito la home), oppure null. */
export function findCareersLink(html, baseUrl) {
  const $ = cheerio.load(html);
  const host = new URL(baseUrl).host;
  const links = $('a[href]')
    .toArray()
    .map((el) => {
      const text = clean($(el).text());
      const href = $(el).attr('href');
      return { url: toUrl(href, baseUrl), rank: Math.min(careersRank(text), careersRank(href)) };
    })
    .filter((l) => l.url && l.rank < Infinity)
    // Prima gli indizi più forti; a parità, i link dello stesso sito (ma vanno bene anche le piattaforme esterne).
    .sort((a, b) => a.rank - b.rank || (b.url.host === host) - (a.url.host === host));
  return links[0]?.url.href ?? null;
}

/** Indirizzi elencati in una mappa del sito (sitemap.xml o indice di sitemap). */
export function sitemapLocations(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

/** Cerca la pagina delle offerte nella mappa del sito. */
async function findInSitemap(origin, fetchText) {
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  try {
    const robots = await fetchText(`${origin}/robots.txt`);
    queue.unshift(...[...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]));
  } catch {
    // niente robots.txt
  }
  const visited = new Set();
  const candidates = [];
  while (queue.length && visited.size < 8) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let xml;
    try {
      xml = await fetchText(url);
    } catch {
      continue;
    }
    for (const loc of sitemapLocations(xml)) {
      if (/\.xml(\.gz)?$/i.test(loc)) {
        // Indice di sitemap: prima quelle delle pagine, che di solito contengono "lavora con noi".
        if (/page|pagin/i.test(loc)) queue.unshift(loc);
        else queue.push(loc);
      } else {
        const path = decodeURIComponent(new URL(loc).pathname);
        const rank = careersRank(path);
        if (rank < 2) candidates.push({ loc, rank, length: path.length });
      }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.length - b.length);
  return candidates[0]?.loc ?? null;
}

/** Prova gli indirizzi più comuni; restituisce il primo che risponde con una pagina sulle offerte. */
async function findCommonPath(origin, fetchText) {
  for (const path of COMMON_PATHS) {
    try {
      const html = await fetchText(`${origin}${path}`);
      if (CAREERS_PATTERNS.some((re) => re.test(html))) return { url: `${origin}${path}`, html };
    } catch {
      // indirizzo inesistente
    }
  }
  return null;
}

/**
 * Trova la pagina delle offerte di un sito: l'indirizzo stesso se lo è già (o se "direct"), altrimenti un
 * link nella pagina, la mappa del sito, gli indirizzi più comuni.
 * @returns {Promise<{ url: string, html: string, via: string }>}
 */
export async function discoverCareersPage(page, fetchText = getText) {
  const html = await fetchText(page.url);
  const start = new URL(page.url);
  if (page.direct || careersRank(start.pathname) < 2) return { url: page.url, html, via: 'indirizzo indicato' };

  const link = findCareersLink(html, page.url);
  if (link) return { url: link, html: await fetchText(link), via: 'link nella home' };
  const fromSitemap = await findInSitemap(start.origin, fetchText);
  if (fromSitemap) return { url: fromSitemap, html: await fetchText(fromSitemap), via: 'mappa del sito' };
  const common = await findCommonPath(start.origin, fetchText);
  if (common) return { ...common, via: 'indirizzo comune' };
  throw new Error(
    `${page.company}: nessuna pagina "lavora con noi" trovata (link nella home, mappa del sito, indirizzi comuni). ` +
      'Se esiste, indica il suo indirizzo con "direct": true; altrimenti togli questa pagina dal profilo.',
  );
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
  // Pagina effettivamente usata per ogni azienda e come è stata trovata (lo mostra "doctor").
  const resolved = new Map();
  const fetchPage = (page) => {
    if (!cache.has(page.url)) {
      cache.set(
        page.url,
        discoverCareersPage(page).then(({ url, html, via }) => {
          resolved.set(page.company, { url, via });
          return parseCareersPage(html, url);
        }),
      );
    }
    return cache.get(page.url);
  };

  return {
    name,
    label: label ?? name,
    supports,
    resolved,
    async search({ warn }) {
      const jobs = [];
      const errors = [];
      for (const page of pages) {
        try {
          const items = await fetchPage(page);
          jobs.push(
            ...items.map((item) =>
              makeJob(name, {
                ...item,
                company: item.company || page.company,
                location: item.location || page.location || '',
                id: `${page.company}:${item.url}#${item.title}`,
                remote: item.remote ?? page.remote ?? remote,
              }),
            ),
          );
        } catch (err) {
          if (!err.message.startsWith(page.company)) err.message = `${page.company}: ${err.message}`;
          errors.push(err);
        }
      }
      // Se non funziona nessuna pagina è un errore della fonte (si tiene il primo errore, con il suo codice
      // HTTP per i suggerimenti di "doctor"); altrimenti si segnalano solo le pagine che non vanno.
      if (errors.length === pages.length) {
        errors[0].message = errors.map((e) => e.message).join(' | ');
        throw errors[0];
      }
      errors.forEach((e) => warn?.(e.message));
      return jobs;
    },
  };
}

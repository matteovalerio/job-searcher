import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { writeFileAtomic } from '../atomic.js';
import { getText } from '../http.js';
import { escapeHtml, splitTelegram } from '../notify.js';
import { stateDir } from '../paths.js';
import { findCareersLink, parseCareersPage } from '../sources/careers.js';
import { compileKeywords, findKeywords, normalize } from '../text.js';
import { kindLabel } from './sectors.js';

/*
 * Sorveglianza delle aziende seguite: si arriva prima degli altri a un annuncio, anche se non finisce sui
 * portali. Per ogni azienda si guarda la pagina "lavora con noi" (se c'è, altrimenti la home) e la si confronta
 * con l'istantanea precedente:
 *   - nuovi annunci (link o titoli comparsi nella pagina "lavora con noi"), segnati se pertinenti al profilo;
 *   - frasi come "cerchiamo" o "posizioni aperte" comparse nella home;
 *   - una pagina "lavora con noi" comparsa dove prima non c'era;
 *   - una pagina "lavora con noi" cambiata, senza annunci riconosciuti.
 * La prima volta si salva solo l'istantanea: le novità si vedono dal controllo successivo.
 * File: .job-searcher/watch.json.
 */

const MAX_EVENTS = 300;

// Frasi con cui un sito dice che cerca personale (nella home, dove "lavora con noi" nel menu non basta).
const HIRING = compileKeywords([
  'cerchiamo',
  'stiamo cercando',
  'posizioni aperte',
  'posizione aperta',
  'selezioniamo',
  'selezione di personale',
  'ricerca di personale',
  'offerta di lavoro',
  'offerte di lavoro',
  'entra nel nostro team',
  'we are hiring',
  "we're hiring",
  'open positions',
  'join our team',
]);

// Voci di menu e link di servizio: non sono annunci.
const NOT_AN_OFFER =
  /^(home|homepage|chi siamo|contatti|contattaci|privacy|cookie|note legali|catalogo|autori|news|blog|eventi|shop|carrello|accedi|login|registrati|newsletter|cerca|lavora con noi|careers|job|jobs|facebook|instagram|linkedin|youtube|twitter|torna su|leggi (tutto|di più)|scopri di più|mostra di più|english|italiano)$/i;

const fileOf = () => stateDir('watch.json');

export async function loadWatch(file = fileOf()) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { byId: {}, events: [], lastDiscovery: null };
  }
}

export async function saveWatch(state, file = fileOf()) {
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Testo principale della pagina, senza menu, piè di pagina e script. */
function mainText($) {
  $('script, style, noscript, nav, header, footer, form, svg, iframe').remove();
  // Uno spazio dopo i blocchi, altrimenti titoli e paragrafi si attaccano ("Studio PagineServizi…").
  $('br, p, li, div, h1, h2, h3, h4, h5, h6, td, section, article').after(' ');
  const root = $('main').length ? $('main') : $('body');
  return root.text().replace(/\s+/g, ' ').trim();
}

/**
 * Istantanea di una pagina: impronta del testo (senza numeri, così date e contatori non contano come cambi),
 * possibili annunci (solo per le pagine "lavora con noi") e frasi di ricerca di personale.
 */
export function snapshot(html, url, kind) {
  const items =
    kind === 'careers'
      ? parseCareersPage(html, url)
          .filter((i) => !NOT_AN_OFFER.test(i.title.trim()) && i.title.split(' ').length <= 16)
          .slice(0, 100)
      : [];
  const text = mainText(cheerio.load(html));
  const norm = normalize(text);
  const hiring = findKeywords(norm, HIRING).map((phrase) => {
    const i = norm.indexOf(normalize(phrase));
    return text.slice(Math.max(0, i - 40), i + 120).trim();
  });
  return {
    url,
    kind,
    hash: createHash('sha1').update(norm.replace(/\d+/g, '#')).digest('hex').slice(0, 16),
    items,
    hiring,
  };
}

const itemKey = (i) => `${normalize(i.title)}|${i.url}`;

/**
 * Novità tra due istantanee della stessa azienda.
 * @param {object|null} prev
 * @param {object} next
 * @param {{ keywords?: object[] }} [options]  parole del profilo (compilate) per segnare gli annunci pertinenti
 */
export function compareSnapshots(prev, next, { keywords = [] } = {}) {
  if (!prev) return [];
  const events = [];
  if (prev.kind === 'home' && next.kind === 'careers') {
    events.push({ type: 'pagina-trovata', url: next.url });
  }
  if (prev.kind === next.kind && next.kind === 'careers') {
    const before = new Set(prev.items.map(itemKey));
    for (const item of next.items.filter((i) => !before.has(itemKey(i)))) {
      events.push({
        type: 'annuncio',
        title: item.title,
        url: item.url,
        relevant: keywords.length > 0 && findKeywords(normalize(item.title), keywords).length > 0,
      });
    }
  }
  const newHiring = next.hiring.filter((h) => !prev.hiring.some((p) => normalize(p) === normalize(h)));
  for (const h of newHiring.slice(0, 2)) events.push({ type: 'avviso', text: h, url: next.url });
  if (!events.length && prev.kind === next.kind && next.kind === 'careers' && prev.hash !== next.hash) {
    events.push({ type: 'pagina-cambiata', url: next.url });
  }
  return events;
}

/** Aziende da sorvegliare: tutte quelle con un sito, tranne quelle che non interessano più. */
export const watchable = (store) =>
  store.items.filter((p) => p.website && !['scartata', 'rifiutata'].includes(p.status));

/**
 * Controlla le aziende e aggiorna le istantanee. Tre siti alla volta.
 * @param {import('./store.js').Publishers} store
 * @param {object} state  vedi loadWatch
 * @param {{ fetchText?, profile?, now?, concurrency? }} options
 * @returns {Promise<{ events: object[], checked: number, problems: string[] }>}
 */
export async function watchPublishers(
  store,
  state,
  { fetchText = getText, profile = null, now = new Date().toISOString(), concurrency = 3 } = {},
) {
  const keywords = compileKeywords([...(profile?.keywords ?? []), ...(profile?.relatedKeywords ?? [])]);
  const queue = [...watchable(store)];
  const events = [];
  const problems = [];
  let checked = 0;

  async function visit(p) {
    const url = p.careersUrl ?? p.website;
    let html;
    try {
      html = await fetchText(url, { timeoutMs: 20000 });
    } catch (err) {
      problems.push(`${p.name}: ${err.message}`);
      return;
    }
    let kind = p.careersUrl ? 'careers' : 'home';
    let next = snapshot(html, url, kind);
    // Dalla home si cerca ogni volta il link alla pagina "lavora con noi": se compare, la si segue.
    if (kind === 'home') {
      const careers = findCareersLink(html, url);
      if (careers) {
        store.enrich(p.id, { careersUrl: careers }, now);
        try {
          kind = 'careers';
          next = snapshot(await fetchText(careers, { timeoutMs: 20000 }), careers, kind);
        } catch {
          kind = 'home';
        }
      }
    }
    const prev = state.byId[p.id] ?? null;
    const found = compareSnapshots(prev, next, { keywords });
    state.byId[p.id] = {
      ...next,
      checkedAt: now,
      changedAt: prev && prev.hash !== next.hash ? now : (prev?.changedAt ?? now),
    };
    for (const e of found) events.push({ ...e, at: now, publisherId: p.id, name: p.name, kind: p.kind });
    checked++;
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await visit(p);
    }),
  );
  // Prima gli annunci pertinenti, poi gli altri annunci, gli avvisi, le pagine nuove e quelle cambiate.
  const order = ['annuncio', 'avviso', 'pagina-trovata', 'pagina-cambiata'];
  events.sort((a, b) => (b.relevant ?? false) - (a.relevant ?? false) || order.indexOf(a.type) - order.indexOf(b.type));
  state.events = [...events, ...(state.events ?? [])].slice(0, MAX_EVENTS);
  return { events, checked, problems };
}

/** Una riga di testo per una novità. */
export function describeEvent(e) {
  switch (e.type) {
    case 'annuncio':
      return `nuovo annuncio${e.relevant ? ' (pertinente)' : ''}: «${e.title}»`;
    case 'avviso':
      return `sul sito: «${e.text}»`;
    case 'pagina-trovata':
      return 'è comparsa una pagina «lavora con noi»';
    default:
      return 'la pagina «lavora con noi» è cambiata';
  }
}

/**
 * Messaggio per Telegram ed email: le novità delle aziende seguite e le aziende nuove trovate dalla ricerca.
 * @returns {{ subject, text, html, telegram: string[] } | null}  null se non c'è niente da dire
 */
export function buildWatchMessage({ events = [], added = [], profileName = '', maxAdded = 20 }) {
  if (!events.length && !added.length) return null;
  const moreAdded = Math.max(0, added.length - maxAdded);
  const subject = [
    events.length && `${events.length} novità dalle aziende seguite`,
    added.length && `${added.length} aziende nuove`,
  ]
    .filter(Boolean)
    .join(', ');
  const eventLines = events.map((e) => ({ title: e.name, line: describeEvent(e), url: e.url }));
  const addedLines = added.slice(0, maxAdded).map((p) => ({
    title: p.name,
    line: [kindLabel(p.kind), p.city].filter(Boolean).join(' · '),
    url: p.website,
  }));
  const text = [
    `${subject}${profileName ? ` (${profileName})` : ''}`,
    ...(eventLines.length
      ? ['', 'Novità:', ...eventLines.map((l) => `- ${l.title}: ${l.line}${l.url ? `\n  ${l.url}` : ''}`)]
      : []),
    ...(addedLines.length
      ? ['', 'Aziende nuove (da valutare):', ...addedLines.map((l) => `- ${l.title} (${l.line})`)]
      : []),
    ...(moreAdded ? [`… e altre ${moreAdded}: le trovi nell'elenco`] : []),
  ].join('\n');
  const more = moreAdded ? `<p>… e altre ${moreAdded}: le trovi nell'elenco.</p>` : '';
  const li = (l) =>
    `<li>${l.url ? `<a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a>` : escapeHtml(l.title)}: ${escapeHtml(l.line)}</li>`;
  const html = `<div style="font-family:sans-serif">
<h2>${escapeHtml(subject)}</h2>
${eventLines.length ? `<h3>Novità</h3><ul>${eventLines.map(li).join('')}</ul>` : ''}
${addedLines.length ? `<h3>Aziende nuove (da valutare)</h3><ul>${addedLines.map(li).join('')}</ul>` : ''}
${more}
</div>`;
  const tg = (l) =>
    `• ${l.url ? `<a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a>` : escapeHtml(l.title)}: ${escapeHtml(l.line)}`;
  const telegram = splitTelegram([
    `🏢 <b>${escapeHtml(subject)}</b>`,
    ...(eventLines.length ? ['', '<b>Novità</b>', ...eventLines.map(tg)] : []),
    ...(addedLines.length ? ['', '<b>Aziende nuove (da valutare)</b>', ...addedLines.map(tg)] : []),
    ...(moreAdded ? [`… e altre ${moreAdded}: le trovi nell'elenco`] : []),
  ]);
  return { subject, text, html, telegram };
}

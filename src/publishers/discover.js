import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { distanceKm, findComune } from '../geo.js';
import { getJson, getText, sleep } from '../http.js';
import { stateDir } from '../paths.js';
import { findCareersLink } from '../sources/careers.js';
import { normalize } from '../text.js';
import { searchGoogleMaps } from './maps.js';
import { PUBLISHING_SECTORS, SECTORS, sectorById } from './sectors.js';
import { detectSpecialties, guessKind } from './specialties.js';
import { normalizeWebsite, publisherKey } from './store.js';
import { searchWeb } from './websearch.js';

/*
 * Ricerca di case editrici e aziende dei settori affini (vedi sectors.js) attorno a una o più città, da fonti
 * aperte che si possono interrogare liberamente (con moderazione):
 *   - OpenStreetMap (Overpass API): uffici e attività del settore, con sito, email e indirizzo;
 *   - Wikidata: case editrici con la sede entro il raggio e con il sito ufficiale;
 *   - la ricerca web, se c'è la chiave (vedi websearch.js).
 * Poi, per ognuna, si può visitare il sito per capirne la specializzazione e trovare email e "lavora con noi".
 */

// Server Overpass pubblici: se il primo rifiuta o è sovraccarico si prova il successivo.
// OVERPASS_URL (anche più indirizzi separati da virgola) li sostituisce.
const OVERPASS_URLS = (
  process.env.OVERPASS_URL ??
  [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ].join(',')
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const WIKIDATA_URL = 'https://query.wikidata.org/sparql';
// Wikidata e OpenStreetMap chiedono un User-Agent che identifichi il programma (con uno da browser, Overpass
// può rispondere 406).
const WIKIDATA_UA =
  'job-searcher/0.1 (ricerca personale di case editrici; https://github.com/matteovalerio/job-searcher)';

/** Testo breve dalla risposta di errore di un server (spesso una pagina HTML con la spiegazione). */
const errorText = (body) =>
  body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Intestazione fissa delle pagine di errore di Overpass: non dice niente sull'errore.
    .replace(
      /OSM3S Response|The data included in this document is from \S+\.|The data is made available under ODbL\./g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

/**
 * Stato dei server durante una ricerca: quello che ha risposto si prova per primo, e quelli che non rispondono
 * affatto (tempo scaduto, connessione rifiutata) si saltano per le query successive.
 */
export function overpassServers() {
  return { good: null, down: new Set() };
}

function serverOrder(urls, servers) {
  if (!servers) return urls;
  const alive = urls.filter((u) => !servers.down.has(new URL(u).host));
  // Se sembrano tutti giù si riprova comunque con tutti: magari nel frattempo uno è tornato.
  const list = alive.length ? alive : urls;
  return [...list].sort((a, b) => (new URL(b).host === servers.good) - (new URL(a).host === servers.good));
}

/**
 * Esegue una query Overpass provando i server uno dopo l'altro. Si passa al successivo se un server rifiuta
 * (406, 403), è sovraccarico (429, 5xx), non risponde o risponde con un errore di esecuzione.
 */
export async function fetchOverpass(
  query,
  { fetchFn = fetch, urls = OVERPASS_URLS, timeoutMs = 45000, busyPause = 10000, servers = null } = {},
) {
  const failures = [];
  for (const url of serverOrder(urls, servers)) {
    const host = new URL(url).host;
    // Un server sovraccarico ("too busy", 429, 504 "open64") spesso risponde dopo qualche secondo: si riprova
    // una volta prima di passare al successivo.
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await tryOverpass(url, host, query, fetchFn, timeoutMs);
      if (outcome.json) {
        if (servers) servers.good = host;
        return outcome.json;
      }
      if (outcome.unreachable) servers?.down.add(host);
      if (outcome.busy && attempt === 0) {
        if (busyPause) await sleep(busyPause);
        continue;
      }
      failures.push(outcome.failure);
      if (outcome.fatal) throw new Error(`query non valida. ${outcome.failure}`);
      break;
    }
  }
  throw new Error(`nessun server ha risposto. ${failures.join(' | ')}`);
}

const BUSY = /open64|dispatcher|too busy|rate_limited|timeout|timed out/i;

async function tryOverpass(url, host, query, fetchFn, timeoutMs) {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'User-Agent': WIKIDATA_UA,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = errorText(await res.text().catch(() => ''));
      const failure = `${host}: HTTP ${res.status}${text ? ` (${text})` : ''}`;
      // 400 = query non valida: inutile riprovare altrove.
      return { failure, fatal: res.status === 400, busy: res.status === 429 || (res.status >= 500 && BUSY.test(text)) };
    }
    const json = await res.json();
    // Query troppo pesante: Overpass risponde 200 ma con un "remark" di errore e senza elementi.
    if (!json.elements?.length && /error|timed out|out of memory/i.test(json.remark ?? '')) {
      return { failure: `${host}: ${json.remark.trim().slice(0, 160)}`, busy: BUSY.test(json.remark) };
    }
    return { json };
  } catch (err) {
    return {
      failure: `${host}: ${err.name === 'TimeoutError' ? 'nessuna risposta' : (err.cause?.code ?? err.message)}`,
      unreachable: true,
    };
  }
}

/** Centro della ricerca: un comune italiano (con le sue coordinate). */
export function resolveCenter(place) {
  const comune = findComune(place);
  if (!comune) throw new Error(`Non riconosco il comune "${place}": scrivi il nome di un comune italiano, es. Padova.`);
  return { name: comune.name, lat: comune.lat, lon: comune.lon };
}

/** Rettangolo (sud, ovest, nord, est) che contiene il cerchio di raggio `radiusKm` attorno al centro. */
export function bbox({ lat, lon }, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = (n) => Math.round(n * 10000) / 10000;
  return [r(lat - dLat), r(lon - dLon), r(lat + dLat), r(lon + dLon)];
}

/**
 * Query Overpass per i settori indicati. Si usa il rettangolo attorno alla città invece del cerchio: per i
 * server è molto più leggero; chi sta fuori dal raggio si scarta poi (vedi searchMaps).
 */
export function overpassQuery(center, radiusKm, sectors = PUBLISHING_SECTORS) {
  const area = `(${bbox(center, radiusKm).join(',')})`;
  const selectors = sectors.flatMap((id) => sectorById(id)?.osm ?? []);
  return `[out:json][timeout:40];
(
${selectors.map((sel) => `  nwr${sel}${area};`).join('\n')}
);
out center tags;`;
}

// Nomi che contengono le parole cercate ma non sono editori.
const NOT_PUBLISHER = /\b(libreria|cartoleria|edicola|tabacchi|biblioteca|scuola|parrucchier|ristorante|bar|negozio)\b/;
// ...a meno che il nome dica anche che pubblicano ("Libreria Editrice …").
const notPublisher = (name) => {
  const n = normalize(name);
  return NOT_PUBLISHER.test(n) && !/editric|edizion|editore|publish/.test(n);
};

/**
 * Settore di un elemento di OpenStreetMap tra quelli cercati, nell'ordine della tabella dei settori
 * ("Libreria Editrice Il Leggio" è una casa editrice, "Libreria Universitaria" una libreria), oppure null.
 */
function classify(tags, sectors) {
  for (const s of SECTORS) {
    if (!sectors.includes(s.id) || !s.matches(tags)) continue;
    // Tra gli editori, i nomi da negozio (cartoleria, edicola…) non contano: si prova il settore successivo.
    if (s.id === 'casa-editrice' && notPublisher(tags.name)) continue;
    return s.id === 'casa-editrice' ? guessKind(tags.name) : s.id;
  }
  return null;
}

/** Aziende dalla risposta di Overpass, ognuna con il suo settore. */
export function parseOverpass(json, center, sectors = PUBLISHING_SECTORS) {
  return (json.elements ?? [])
    .filter((el) => el.tags?.name)
    .map((el) => ({ el, kind: classify(el.tags, sectors) }))
    .filter(({ kind }) => kind)
    .map(({ el, kind }) => {
      const t = el.tags;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
      return {
        name: t.name,
        website: normalizeWebsite(t.website ?? t['contact:website'] ?? t.url),
        email: t.email ?? t['contact:email'] ?? null,
        phone: t.phone ?? t['contact:phone'] ?? null,
        city: t['addr:city'] ?? null,
        address: [street, t['addr:postcode'], t['addr:city']].filter(Boolean).join(', ') || null,
        lat,
        lon,
        distanceKm: lat != null && center ? Math.round(distanceKm(center, { lat, lon })) : null,
        kind,
        description: t.description ?? null,
        source: 'openstreetmap',
      };
    });
}

export function wikidataQuery({ lat, lon }, radiusKm) {
  return `SELECT DISTINCT ?item ?itemLabel ?website ?placeLabel ?coord ?genreLabel ?inception WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  # sede (P159) oppure comune in cui si trova (P131)
  { ?item wdt:P159 ?place } UNION { ?item wdt:P131 ?place }
  ?item wdt:P31/wdt:P279* wd:Q2085381 .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  FILTER NOT EXISTS { ?item wdt:P582 ?ended }
  # solo con il sito ufficiale: gli stampatori storici (Venezia del Cinquecento…) non ce l'hanno
  ?item wdt:P856 ?website .
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P136 ?genre }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}
LIMIT 300`;
}

/** Prima di quest'anno è una casa editrice storica, anche se su Wikidata non risulta chiusa. */
const OLDEST_FOUNDATION = 1800;

/**
 * Case editrici dalla risposta di Wikidata (una riga per genere: si uniscono). Si tengono solo quelle con il
 * sito ufficiale e fondate dal 1800 in poi: Wikidata elenca anche gli stampatori storici, spesso senza data
 * di chiusura.
 */
export function parseWikidata(json, center) {
  const byItem = new Map();
  for (const row of json.results?.bindings ?? []) {
    const id = row.item.value;
    const name = row.itemLabel?.value;
    // Senza etichetta in italiano o inglese Wikidata restituisce il codice (Q123): meglio saltare.
    if (!name || /^Q\d+$/.test(name) || notPublisher(name)) continue;
    if (!row.website?.value) continue;
    const founded = Number(/^-?\d{1,4}/.exec(row.inception?.value ?? '')?.[0]);
    if (founded && founded < OLDEST_FOUNDATION) continue;
    const point = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(row.coord?.value ?? '');
    const lat = point ? Number(point[2]) : null;
    const lon = point ? Number(point[1]) : null;
    const item = byItem.get(id) ?? {
      name,
      website: normalizeWebsite(row.website?.value),
      city: row.placeLabel?.value ?? null,
      lat,
      lon,
      distanceKm: lat != null && center ? Math.round(distanceKm(center, { lat, lon })) : null,
      kind: 'casa-editrice',
      genres: [],
      source: 'wikidata',
      wikidata: id,
    };
    if (row.genreLabel?.value && !item.genres.includes(row.genreLabel.value)) item.genres.push(row.genreLabel.value);
    byItem.set(id, item);
  }
  return [...byItem.values()].map(({ genres, ...p }) => ({
    ...p,
    specialties: detectSpecialties(genres.join(' ')),
  }));
}

/** Unisce i risultati delle fonti: stessa casa editrice (sito o nome) = una voce, con i dati completati. */
export function mergeResults(lists) {
  const merged = new Map();
  for (const p of lists.flat()) {
    const key = publisherKey(p);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...p, sources: [p.source] });
      continue;
    }
    for (const [k, v] of Object.entries(p)) if (prev[k] == null && v != null) prev[k] = v;
    if (!prev.specialties?.length && p.specialties?.length) prev.specialties = p.specialties;
    if (!prev.sources.includes(p.source)) prev.sources.push(p.source);
  }
  return [...merged.values()].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

const OSM_CACHE_HOURS = 24;
// Se i server non rispondono, risultati salvati usabili comunque (con un avviso).
const OSM_STALE_DAYS = 30;

/**
 * Query Overpass con una memoria di 24 ore su file: ripetere la stessa ricerca (stessa zona, stesso settore)
 * non interroga di nuovo i server pubblici, che sono spesso sovraccarichi. Se i server non rispondono si usano
 * i risultati salvati anche se più vecchi (fino a 30 giorni): `stale` dice di quando sono.
 * @returns {Promise<{ json: object, stale?: string }>}
 */
async function cachedOverpass(query, { cacheDir, ...options }) {
  if (!cacheDir) return { json: await fetchOverpass(query, options) };
  const file = path.join(cacheDir, `${createHash('sha1').update(query).digest('hex').slice(0, 16)}.json`);
  let saved = null;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - new Date(saved.at).getTime() < OSM_CACHE_HOURS * 3600 * 1000) return { json: saved.json };
  } catch {
    // niente in memoria (o file illeggibile): si interroga il server
  }
  try {
    const json = await fetchOverpass(query, options);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify({ at: new Date().toISOString(), json }));
    return { json };
  } catch (err) {
    if (saved?.json && Date.now() - new Date(saved.at).getTime() < OSM_STALE_DAYS * 86400 * 1000) {
      return { json: saved.json, stale: saved.at };
    }
    throw err;
  }
}

/**
 * OpenStreetMap, un settore alla volta: query piccole che i server pubblici reggono, e se un settore fallisce
 * gli altri arrivano comunque. Dopo due settori falliti di fila si smette (i server sono giù o sovraccarichi).
 */
async function searchOsm(center, radiusKm, sectors, http, problems, cacheDir, osm) {
  const out = [];
  let failedInARow = 0;
  for (const id of sectors.filter((s) => sectorById(s)?.osm.length)) {
    try {
      // Una query alla volta anche con più città: i server pubblici limitano le richieste contemporanee.
      const { json, stale } = await osm.queue(() =>
        cachedOverpass(overpassQuery(center, radiusKm, [id]), {
          cacheDir,
          fetchFn: http.fetch ?? fetch,
          busyPause: http.busyPause,
          servers: osm.servers,
        }),
      );
      if (stale) {
        problems.push(
          `OpenStreetMap (${center.name}, ${sectorById(id).label.toLowerCase()}): i server non rispondono, ` +
            `uso i risultati salvati il ${new Date(stale).toLocaleDateString('it-IT')}.`,
        );
      }
      out.push(...parseOverpass(json, center, sectors).filter((p) => p.distanceKm == null || p.distanceKm <= radiusKm));
      failedInARow = 0;
    } catch (err) {
      problems.push(`OpenStreetMap (${center.name}, ${sectorById(id).label.toLowerCase()}): ${err.message}`);
      if (++failedInARow >= 2) {
        problems.push(
          `OpenStreetMap (${center.name}): i server pubblici sono sovraccarichi o non rispondono (non dipende da ` +
            "job-searcher), gli altri settori non sono stati cercati. Riprova tra un po': i settori già trovati " +
            'restano in memoria per 24 ore. Intanto puoi usare la ricerca web o «Chiedi a Claude».',
        );
        break;
      }
    }
  }
  return out;
}

async function searchMaps(center, radiusKm, sectors, http, problems, cacheDir, osm) {
  const fromOsm = searchOsm(center, radiusKm, sectors, http, problems, cacheDir, osm);
  // Wikidata serve solo per le case editrici.
  const fromWikidata = !sectors.includes('casa-editrice')
    ? Promise.resolve([])
    : http
        .getJson(`${WIKIDATA_URL}?format=json&query=${encodeURIComponent(wikidataQuery(center, radiusKm))}`, {
          headers: { 'User-Agent': WIKIDATA_UA, Accept: 'application/sparql-results+json' },
          timeoutMs: 60000,
        })
        .then((json) => parseWikidata(json, center))
        .catch((err) => {
          problems.push(`Wikidata (${center.name}): ${err.message}`);
          return [];
        });
  return (await Promise.all([fromOsm, fromWikidata])).flat();
}

/** Distanza dal centro più vicino (con più città la ricerca ha più centri). */
function nearest(p, centers) {
  if (p.lat == null || p.lon == null) return p;
  return { ...p, distanceKm: Math.round(Math.min(...centers.map((c) => distanceKm(c, p)))) };
}

/**
 * Cerca aziende dei settori indicati (predefiniti: case editrici, studi editoriali e librerie) entro
 * `radiusKm` da una o più città: OpenStreetMap, Wikidata e, se ci sono le chiavi, Google Maps
 * (GOOGLE_MAPS_API_KEY) e il web (BRAVE_SEARCH_API_KEY).
 * @param {{ places?: string[], place?: string, radiusKm?: number, sectors?: string[] }} options
 * @returns {Promise<{ centers, results: object[], problems: string[], webSearch: boolean, googleMaps: boolean }>}
 */
export async function discoverPublishers({
  places,
  place,
  radiusKm = 30,
  sectors = PUBLISHING_SECTORS,
  http = { fetch: (...args) => fetch(...args), getJson },
  // Cartella della memoria di OpenStreetMap (null per non usarla, come nei test).
  osmCache = stateDir('osm-cache'),
  web = searchWeb,
  maps = searchGoogleMaps,
} = {}) {
  const names = (places ?? String(place ?? '').split(',')).map((p) => p.trim()).filter(Boolean);
  if (!names.length) throw new Error('Indica almeno una città, es. Padova.');
  const centers = names.map(resolveCenter);
  const problems = [];
  let last = Promise.resolve();
  const osm = {
    servers: overpassServers(),
    queue: (fn) => {
      const next = last.then(fn);
      last = next.catch(() => {});
      return next;
    },
  };
  const [openData, fromGoogle, fromWeb] = await Promise.all([
    Promise.all(centers.map((c) => searchMaps(c, radiusKm, sectors, http, problems, osmCache, osm))),
    maps(centers, { sectors, radiusKm }),
    web(
      centers.map((c) => c.name),
      { sectors },
    ),
  ]);
  problems.push(...fromGoogle.problems, ...fromWeb.problems);
  const results = mergeResults(
    [...openData, fromGoogle.results, fromWeb.results].map((list) => list.map((p) => nearest(p, centers))),
  );
  return {
    center: centers[0],
    centers,
    results,
    problems,
    webSearch: !fromWeb.skipped,
    googleMaps: !fromGoogle.skipped,
  };
}

// Email da preferire per una candidatura: prima quelle del personale o della redazione.
const EMAIL_RANK = [/lavor|job|career|hr|risorse|personale|recruit|cv/, /redazion|editor/, /info|segreteria|contatt/];
const rankEmail = (email) => {
  const i = EMAIL_RANK.findIndex((re) => re.test(email.split('@')[0]));
  return i < 0 ? EMAIL_RANK.length : i;
};

/** Email trovate in una pagina (link mailto e testo), senza quelle di esempio o delle immagini. */
export function findEmails(html) {
  const $ = cheerio.load(html);
  const found = new Set();
  $('a[href^="mailto:"]').each((_, el) => {
    const email = decodeURIComponent($(el).attr('href').slice(7).split('?')[0]).trim().toLowerCase();
    if (email.includes('@')) found.add(email);
  });
  for (const m of $.root()
    .text()
    .matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g))
    found.add(m[0].toLowerCase());
  return [...found]
    .filter(
      (e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/@(example|esempio|domain|dominio)\.|sentry|wixpress/.test(e),
    )
    .sort((a, b) => rankEmail(a) - rankEmail(b));
}

/**
 * Informazioni ricavate dalla home di una casa editrice: descrizione, specializzazione, email, pagina
 * "lavora con noi" (se c'è un link).
 */
export function analyzeHomepage(html, url) {
  const $ = cheerio.load(html);
  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim();
  const title = $('title').first().text().trim();
  const nav = $('nav, header, h1, h2, .menu')
    .map((_, el) => $(el).text())
    .get()
    .join(' ');
  $('script, style, noscript').remove();
  const body = $('body').text().replace(/\s+/g, ' ').slice(0, 20000);
  const summary = [title, description, nav].join(' ');
  const emails = findEmails(html);
  // La specializzazione si cerca prima in titolo, descrizione e menu; se non basta, nel resto della pagina.
  let specialties = detectSpecialties(summary);
  if (!specialties.length) specialties = detectSpecialties(body, { min: 2 });
  return {
    description: description || null,
    specialties,
    kind: guessKind(summary),
    email: emails[0] ?? null,
    // true se l'indirizzo è quello per il lavoro (lavoro@, hr@, cv@…): vale più di quello generico
    jobsEmail: emails.length > 0 && rankEmail(emails[0]) === 0,
    careersUrl: findCareersLink(html, url),
  };
}

/** Visita il sito e restituisce ciò che si è capito, oppure { problem } se il sito non risponde. */
export async function checkPublisherSite(publisher, fetchText = getText) {
  if (!publisher.website) return { problem: 'nessun sito indicato' };
  try {
    const html = await fetchText(publisher.website, { timeoutMs: 20000 });
    return analyzeHomepage(html, publisher.website);
  } catch (err) {
    return { problem: err.message };
  }
}

import * as cheerio from 'cheerio';
import { distanceKm, findComune } from '../geo.js';
import { getJson, getText, request } from '../http.js';
import { findCareersLink } from '../sources/careers.js';
import { normalize } from '../text.js';
import { detectSpecialties, guessKind } from './specialties.js';
import { normalizeWebsite, publisherKey } from './store.js';
import { searchWeb } from './websearch.js';

/*
 * Ricerca di case editrici e studi editoriali attorno a una città, da due fonti aperte che si possono
 * interrogare liberamente (con moderazione):
 *   - OpenStreetMap (Overpass API): uffici e attività con nome da editore, con sito, email e indirizzo;
 *   - Wikidata: case editrici con la sede entro il raggio, spesso con il sito ufficiale.
 * Poi, per ognuna, si può visitare il sito per capirne la specializzazione e trovare email e "lavora con noi".
 */

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const WIKIDATA_URL = 'https://query.wikidata.org/sparql';
// Wikidata chiede un User-Agent che identifichi il programma.
const WIKIDATA_UA =
  'job-searcher/0.1 (ricerca personale di case editrici; https://github.com/matteovalerio/job-searcher)';

// Parti di nome tipiche di editori e studi editoriali (in minuscolo, per le espressioni regolari di Overpass).
const NAME_PATTERN = 'edizion|editric|editor|editorial|publish|verlag|libri';

/** Centro della ricerca: un comune italiano (con le sue coordinate). */
export function resolveCenter(place) {
  const comune = findComune(place);
  if (!comune) throw new Error(`Non riconosco il comune "${place}": scrivi il nome di un comune italiano, es. Padova.`);
  return { name: comune.name, lat: comune.lat, lon: comune.lon };
}

export function overpassQuery({ lat, lon }, radiusKm) {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lon})`;
  return `[out:json][timeout:60];
(
  nwr["office"="publisher"]${around};
  nwr["office"]["name"~"${NAME_PATTERN}",i]${around};
  nwr["shop"]["name"~"edizion|editric|editore",i]${around};
  nwr["craft"]["name"~"edizion|editric|editorial",i]${around};
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

/** Case editrici dalla risposta di Overpass. */
export function parseOverpass(json, center) {
  return (json.elements ?? [])
    .filter((el) => el.tags?.name && !notPublisher(el.tags.name))
    .filter((el) => el.tags.office || /edizion|editric|editore/i.test(el.tags.name))
    .map((el) => {
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
        kind: guessKind(t.name),
        description: t.description ?? null,
        source: 'openstreetmap',
      };
    });
}

export function wikidataQuery({ lat, lon }, radiusKm) {
  return `SELECT DISTINCT ?item ?itemLabel ?website ?placeLabel ?coord ?genreLabel WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  # sede (P159) oppure comune in cui si trova (P131)
  { ?item wdt:P159 ?place } UNION { ?item wdt:P131 ?place }
  ?item wdt:P31/wdt:P279* wd:Q2085381 .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P136 ?genre }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}
LIMIT 300`;
}

/** Case editrici dalla risposta di Wikidata (una riga per genere: si uniscono). */
export function parseWikidata(json, center) {
  const byItem = new Map();
  for (const row of json.results?.bindings ?? []) {
    const id = row.item.value;
    const name = row.itemLabel?.value;
    // Senza etichetta in italiano o inglese Wikidata restituisce il codice (Q123): meglio saltare.
    if (!name || /^Q\d+$/.test(name) || notPublisher(name)) continue;
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

async function searchMaps(center, radiusKm, http, problems) {
  const fromOsm = http
    .request(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery(center, radiusKm))}`,
      timeoutMs: 70000,
    })
    .then((res) => res.json())
    .then((json) => parseOverpass(json, center))
    .catch((err) => {
      problems.push(`OpenStreetMap (${center.name}): ${err.message}`);
      return [];
    });
  const fromWikidata = http
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
 * Cerca case editrici e studi editoriali entro `radiusKm` da una o più città: OpenStreetMap, Wikidata e, se
 * c'è la chiave BRAVE_SEARCH_API_KEY, la ricerca web.
 * @param {{ places?: string[], place?: string, radiusKm?: number }} options
 * @returns {Promise<{ centers, results: object[], problems: string[], webSearch: boolean }>}
 */
export async function discoverPublishers({
  places,
  place,
  radiusKm = 30,
  http = { request, getJson },
  web = searchWeb,
} = {}) {
  const names = (places ?? String(place ?? '').split(',')).map((p) => p.trim()).filter(Boolean);
  if (!names.length) throw new Error('Indica almeno una città, es. Padova.');
  const centers = names.map(resolveCenter);
  const problems = [];
  const [maps, fromWeb] = await Promise.all([
    Promise.all(centers.map((c) => searchMaps(c, radiusKm, http, problems))),
    web(centers.map((c) => c.name)),
  ]);
  problems.push(...fromWeb.problems);
  const results = mergeResults([...maps, fromWeb.results].map((list) => list.map((p) => nearest(p, centers))));
  return { center: centers[0], centers, results, problems, webSearch: !fromWeb.skipped };
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

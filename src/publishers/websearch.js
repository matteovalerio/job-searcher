import { getJson, sleep } from '../http.js';
import { normalize } from '../text.js';
import { PUBLISHING_SECTORS, sectorById } from './sectors.js';
import { detectSpecialties, guessKind } from './specialties.js';

/*
 * Ricerca web delle aziende con l'API di Brave Search (facoltativa: serve una chiave gratuita in
 * BRAVE_SEARCH_API_KEY). Trova i piccoli editori, gli studi editoriali e le aziende dei settori affini che non
 * sono né sulle mappe né su Wikidata: si cercano le frasi di ogni settore (vedi sectors.js), come "casa editrice
 * Venezia" o "agenzia di comunicazione Padova", e si tengono i siti che sembrano di quel settore.
 */

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

/** Frasi cercate per una città, con il settore a cui appartiene ognuna. */
export const searchQueries = (city, sectors = PUBLISHING_SECTORS) =>
  sectors.flatMap((id) => (sectorById(id)?.web ?? []).map((q) => ({ q: q.replace('{city}', city), sector: id })));

// Siti che non sono aziende da contattare: grandi catene e negozi online, social, elenchi, giornali nazionali.
export const NOT_PUBLISHER_SITES =
  /(^|\.)(amazon|ibs|feltrinelli|lafeltrinelli|mondadoristore|libraccio|hoepli|goodreads|anobii|facebook|instagram|linkedin|youtube|tiktok|twitter|x|pinterest|wikipedia|wikidata|paginegialle|paginebianche|tripadvisor|yelp|google|virgilio|infojobs|indeed|subito|ebay|unilibro|bookdealer|giuntialpunto|repubblica|corriere|gazzettino|ilgazzettino|mattinopadova|ilmattino|nuovavenezia|ansa|glassdoor|kompass|reteimprese|registroimprese|ufficiocamerale|companyreports|informazione-aziende|trovaziende|cylex|misterimprese)\.[a-z.]+$/;

// Parti del titolo da togliere per ricavare il nome ("Home - Edizioni X", "Edizioni X | Sito ufficiale").
const TITLE_NOISE =
  /^(home ?page|home|benvenut[io]|sito ufficiale|official site|chi siamo|catalogo|libri|shop|negozio)$/i;

const compact = (text) => normalize(text).replace(/[^a-z0-9]/g, '');

/**
 * Nome dell'editore dal titolo della pagina, oppure dal dominio. Tra le parti del titolo si preferisce
 * quella che corrisponde al dominio ("Wetlands" per wetlandsbooks.com), poi la più corta: le altre di solito
 * descrivono ("Casa editrice indipendente a Venezia").
 */
export function nameFromTitle(title, host) {
  const parts = String(title ?? '')
    .split(/\s+[|\-–—·•]\s+|:\s+/)
    .map((p) => p.trim())
    .filter((p) => p && p.length <= 60 && !TITLE_NOISE.test(p));
  const domain = compact(host.replace(/^www\./, '').split('.')[0]);
  const matching = parts.find((p) => compact(p).length >= 3 && domain.includes(compact(p)));
  const best = matching ?? [...parts].sort((a, b) => a.length - b.length)[0];
  if (best) return best;
  const base = host.replace(/^www\./, '').split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Candidati dai risultati di una ricerca: un sito per dominio, solo se sembra del settore cercato.
 * @param {{ title, url, description }[]} results
 * @param {string} city
 * @param {string} [sectorId]  settore della frase cercata (predefinito: case editrici)
 */
export function parseSearchResults(results, city, sectorId = 'casa-editrice') {
  const sector = sectorById(sectorId);
  const seen = new Set();
  const out = [];
  for (const r of results) {
    let url;
    try {
      url = new URL(r.url);
    } catch {
      continue;
    }
    const host = url.host.toLowerCase();
    if (seen.has(host) || NOT_PUBLISHER_SITES.test(host)) continue;
    const text = normalize(`${r.title} ${r.description ?? ''}`);
    if (!sector.hint.test(text)) continue;
    seen.add(host);
    const description = String(r.description ?? '')
      .replace(/<[^>]+>/g, '')
      .trim();
    out.push({
      name: nameFromTitle(String(r.title).replace(/<[^>]+>/g, ''), host),
      website: `${url.origin}/`,
      // La città si indica solo se la pagina la nomina: il sito potrebbe essere di un editore altrove.
      city: text.includes(normalize(city)) ? city : null,
      description: description || null,
      // Tra le case editrici si riconoscono gli studi editoriali; negli altri settori vale quello cercato.
      kind: sectorId === 'casa-editrice' ? guessKind(`${r.title} ${description}`) : sectorId,
      specialties: detectSpecialties(`${r.title} ${description}`),
      source: 'ricerca web',
    });
  }
  return out;
}

/**
 * Cerca con Brave Search le frasi di `searchQueries` per ogni città.
 * @returns {Promise<{ results: object[], problems: string[] }>}
 */
export async function searchWeb(
  cities,
  { sectors = PUBLISHING_SECTORS, key = process.env.BRAVE_SEARCH_API_KEY, http = { getJson }, pause = 1100 } = {},
) {
  if (!key) return { results: [], problems: [], skipped: true };
  const results = [];
  const problems = [];
  for (const city of cities) {
    for (const { q, sector } of searchQueries(city, sectors)) {
      const params = new URLSearchParams({ q, country: 'IT', search_lang: 'it', count: '20' });
      try {
        const json = await http.getJson(`${BRAVE_URL}?${params}`, { headers: { 'X-Subscription-Token': key } });
        results.push(...parseSearchResults(json.web?.results ?? [], city, sector));
      } catch (err) {
        problems.push(`Ricerca web ("${q}"): ${err.message}`);
        if (/HTTP (401|403)/.test(err.message)) return { results, problems };
      }
      // Il piano gratuito permette una richiesta al secondo.
      if (pause) await sleep(pause);
    }
  }
  return { results, problems };
}

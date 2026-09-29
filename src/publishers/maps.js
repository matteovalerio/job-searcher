import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { distanceKm } from '../geo.js';
import { stateDir } from '../paths.js';
import { PUBLISHING_SECTORS } from './sectors.js';
import { detectSpecialties, guessKind } from './specialties.js';
import { NOT_PUBLISHER_SITES, searchQueries } from './websearch.js';

/*
 * Ricerca delle aziende su Google Maps (Places API "Text Search", facoltativa: serve una chiave in
 * GOOGLE_MAPS_API_KEY). Trova molte più attività di OpenStreetMap, con il sito. Si cercano le stesse frasi della
 * ricerca web ("casa editrice Padova", "agenzia di comunicazione Padova"), solo dentro la zona.
 *
 * I termini di Google non permettono di conservare i dati dei luoghi: si tengono solo nome, sito e comune,
 * il resto (email, pagina "lavora con noi", specializzazione) arriva dalla visita del sito dell'azienda.
 * Le chiamate si contano per mese e ci si ferma prima della soglia (GOOGLE_MAPS_MONTHLY_LIMIT).
 */

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
// Solo i campi che servono: il costo di una chiamata dipende dai campi chiesti (il sito è nella fascia più cara).
const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.websiteUri',
  'places.businessStatus',
].join(',');
const DEFAULT_MONTHLY_LIMIT = 500;

/** Comune da un indirizzo italiano di Google: "Via Roma, 1, 35016 Piazzola sul Brenta PD, Italia". */
export function cityFromAddress(address) {
  return String(address ?? '').match(/\b\d{5}\s+([^,]+?)(?:\s+[A-Z]{2})?\s*(?:,|$)/)?.[1] ?? null;
}

/**
 * Candidati da una risposta di Text Search: attività aperte, un sito per dominio, senza catene e negozi online,
 * entro il raggio dal centro.
 */
export function parsePlaces(json, center, radiusKm, sectorId = 'casa-editrice') {
  const out = [];
  for (const p of json.places ?? []) {
    const name = p.displayName?.text?.trim();
    if (!name || p.businessStatus === 'CLOSED_PERMANENTLY') continue;
    let website = null;
    if (p.websiteUri) {
      try {
        const url = new URL(p.websiteUri);
        if (NOT_PUBLISHER_SITES.test(url.host.toLowerCase())) continue;
        website = `${url.origin}/`;
      } catch {
        // sito non valido: si tiene l'azienda senza
      }
    }
    const km =
      p.location?.latitude == null ? null : distanceKm(center, { lat: p.location.latitude, lon: p.location.longitude });
    if (km != null && km > radiusKm) continue;
    out.push({
      name,
      website,
      city: cityFromAddress(p.formattedAddress) ?? center.name,
      distanceKm: km == null ? null : Math.round(km),
      kind: sectorId === 'casa-editrice' ? guessKind(name) : sectorId,
      specialties: detectSpecialties(name),
      source: 'google maps',
    });
  }
  return out;
}

/** Contatore delle chiamate del mese, su file (null = solo in memoria, come nei test). */
async function loadUsage(file, month) {
  if (!file) return { month, calls: 0 };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return saved.month === month ? saved : { month, calls: 0 };
  } catch {
    return { month, calls: 0 };
  }
}

async function saveUsage(file, usage) {
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(usage));
}

/** Rettangolo attorno al cerchio, per limitare la ricerca alla zona. */
function rectangle({ lat, lon }, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    low: { latitude: lat - dLat, longitude: lon - dLon },
    high: { latitude: lat + dLat, longitude: lon + dLon },
  };
}

/**
 * Cerca su Google Maps le frasi di ogni settore per ogni centro.
 * @param {{ name, lat, lon }[]} centers
 * @returns {Promise<{ results: object[], problems: string[], skipped?: boolean, calls?: number }>}
 */
export async function searchGoogleMaps(
  centers,
  {
    sectors = PUBLISHING_SECTORS,
    radiusKm = 30,
    key = process.env.GOOGLE_MAPS_API_KEY,
    limit = Number(process.env.GOOGLE_MAPS_MONTHLY_LIMIT) || DEFAULT_MONTHLY_LIMIT,
    fetchFn = (...args) => fetch(...args),
    usageFile = stateDir('google-maps-usage.json'),
    now = new Date(),
    // Numero massimo di frasi da cercare (per la prova di "doctor").
    maxQueries = Number.POSITIVE_INFINITY,
  } = {},
) {
  if (!key) return { results: [], problems: [], skipped: true };
  const usage = await loadUsage(usageFile, now.toISOString().slice(0, 7));
  const results = [];
  const problems = [];
  let calls = 0;
  try {
    for (const center of centers) {
      for (const { q, sector } of searchQueries(center.name, sectors)) {
        if (calls >= maxQueries) return { results, problems, calls };
        if (usage.calls >= limit) {
          problems.push(
            `Google Maps: raggiunto il limite di ${limit} ricerche questo mese (GOOGLE_MAPS_MONTHLY_LIMIT), ` +
              'le altre frasi non sono state cercate.',
          );
          return { results, problems, calls };
        }
        usage.calls++;
        calls++;
        let res;
        try {
          res = await fetchFn(PLACES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
            body: JSON.stringify({
              textQuery: q,
              languageCode: 'it',
              regionCode: 'IT',
              pageSize: 20,
              locationRestriction: { rectangle: rectangle(center, radiusKm) },
            }),
            signal: AbortSignal.timeout(20000),
          });
        } catch (err) {
          problems.push(`Google Maps ("${q}"): ${err.name === 'TimeoutError' ? 'nessuna risposta' : err.message}`);
          continue;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const message = body.error?.message ?? '';
          problems.push(`Google Maps ("${q}"): HTTP ${res.status}${message ? ` (${message.slice(0, 200)})` : ''}`);
          // Chiave sbagliata, API non attiva o quota finita: inutile continuare.
          if ([400, 401, 403, 429].includes(res.status)) {
            if (res.status === 403) {
              problems.push(
                'Google Maps: controlla che la chiave sia giusta e che "Places API (New)" sia attiva per il progetto.',
              );
            }
            return { results, problems, calls };
          }
          continue;
        }
        results.push(...parsePlaces(await res.json(), center, radiusKm, sector));
      }
    }
    return { results, problems, calls };
  } finally {
    await saveUsage(usageFile, usage).catch(() => {});
  }
}

/** Prova della chiave con una sola ricerca ("casa editrice Padova"), per il comando doctor. */
export async function checkGoogleMaps(options = {}) {
  const padova = { name: 'Padova', lat: 45.4064, lon: 11.8768 };
  const started = Date.now();
  const found = await searchGoogleMaps([padova], { ...options, sectors: ['casa-editrice'], maxQueries: 1 });
  return { ...found, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

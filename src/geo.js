import { readFileSync } from 'node:fs';
import { normalize } from './text.js';

/**
 * Geografia dei comuni italiani (data/comuni.json, generato da scripts/build-comuni.js).
 * Serve a capire dove si trova un'offerta ("Abano Terme", "Provincia di Vicenza", "Padova, Veneto, Italia")
 * e quanto dista dai luoghi cercati, perché non tutti i portali rispettano il raggio richiesto.
 */

let cache;

function load() {
  if (cache) return cache;
  const { comuni } = JSON.parse(readFileSync(new URL('../data/comuni.json', import.meta.url), 'utf8'));
  const byName = new Map();
  const provinces = new Map(); // nome o sigla normalizzati -> luogo del capoluogo
  const regions = new Set();
  const add = (map, key, value) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  for (const [nome, nomeAltro, sigla, provincia, regione, lat, lon, capoluogo] of comuni) {
    const place = { name: nome, sigla, province: provincia, region: regione, lat, lon, kind: 'comune' };
    add(byName, normalize(nome), place);
    add(byName, normalize(nomeAltro), place);
    for (const r of regione.split(/\s*\/\s*/)) regions.add(normalize(r));
    if (capoluogo) {
      const prov = { ...place, name: `Provincia di ${provincia}`, kind: 'provincia' };
      for (const key of [sigla, provincia, ...provincia.split(/\s*[/-]\s*|\s+e\s+(?:della\s+)?/)]) {
        if (!provinces.has(normalize(key))) provinces.set(normalize(key), prov);
      }
    }
  }
  cache = { byName, provinces, regions };
  return cache;
}

/** Distanza in km tra due punti { lat, lon } (formula dell'emisenoverso). */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const closestTo = (candidates, near = []) => {
  if (candidates.length === 1 || !near.length) return candidates[0];
  const dist = (c) => Math.min(...near.map((n) => distanceKm(c, n)));
  return [...candidates].sort((a, b) => dist(a) - dist(b))[0];
};

/** Trova un comune per nome, es. "Padova" o "Bozen". Tra omonimi sceglie il più vicino a `near`. */
export function findComune(name, near = []) {
  const candidates = load().byName.get(normalize(name));
  return candidates ? closestTo(candidates, near) : null;
}

const PROVINCE_PREFIX = /^(?:provincia di|province of|area metropolitana di|citta metropolitana di|greater)\s+/;
const AREA_SUFFIX = /\s+(?:e dintorni|area|metropolitan area)$/;

/**
 * Interpreta la località di un'offerta. Restituisce il luogo più preciso riconosciuto:
 *   { kind: 'comune' | 'provincia', name, province, region, lat, lon }
 *   { kind: 'regione', region }     se si capisce solo la regione (es. "Veneto")
 *   null                            se non si riconosce (es. "Italia", "Remote", "Berlin")
 */
export function locate(location, near = []) {
  const { provinces, regions } = load();
  const parts = String(location ?? '')
    .split(/[,;|]|\s+-\s+/)
    .map((p) => normalize(p.replace(/\((\w{2})\)/, ', $1')))
    .flatMap((p) => p.split(','))
    .map((p) => p.trim())
    .filter(Boolean);

  let region = null;
  for (const part of parts) {
    const comune = findComune(part, near);
    if (comune) return comune;
    const isProvince = PROVINCE_PREFIX.test(part);
    const bare = part.replace(PROVINCE_PREFIX, '').replace(AREA_SUFFIX, '');
    if (bare !== part) {
      const comuneArea = !isProvince && findComune(bare, near);
      if (comuneArea) return comuneArea;
    }
    const province = provinces.get(bare);
    if (province && (isProvince || bare.length === 2 || !regions.has(bare))) return province;
    if (!region && regions.has(bare)) region = bare;
  }
  return region ? { kind: 'regione', region } : null;
}

// Una provincia è indicata col suo capoluogo: si concede un margine per i comuni lontani da esso.
const PROVINCE_SLACK_KM = 25;

/**
 * Controlla se una località è entro `radiusKm` da almeno uno dei luoghi cercati (o nella stessa provincia).
 * @returns {{ ok: boolean, distanceKm?: number, reason?: string }}
 */
export function checkDistance(location, places, radiusKm) {
  const where = locate(location, places);
  if (!where) return { ok: false, reason: 'località non riconosciuta' };
  if (where.kind === 'regione') {
    const ok = places.some((p) =>
      normalize(p.region)
        .split(/\s*\/\s*/)
        .includes(where.region),
    );
    return ok ? { ok } : { ok, reason: 'fuori zona' };
  }
  // Tutta la provincia di un luogo cercato conta come "zona", anche oltre il raggio.
  if (places.some((p) => p.sigla && p.sigla === where.sigla)) return { ok: true };
  const distance = Math.min(...places.map((p) => distanceKm(p, where)));
  const limit = radiusKm + (where.kind === 'provincia' ? PROVINCE_SLACK_KM : 0);
  return {
    ok: distance <= limit,
    distanceKm: Math.round(distance),
    reason: distance <= limit ? undefined : 'fuori zona',
  };
}

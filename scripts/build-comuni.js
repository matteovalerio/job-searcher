#!/usr/bin/env node
// Genera data/comuni.json (nome, provincia, regione e coordinate dei comuni italiani)
// a partire dal pacchetto "italian-cap-comuni-province" (licenza MIT).
// Uso: npm run build:comuni
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('italian-cap-comuni-province'));
const file = readdirSync(dist).find((f) => f.startsWith('gi_comuni_cap') && f.endsWith('.json'));
const rows = JSON.parse(readFileSync(path.join(dist, file), 'utf8'));

// Lo stesso comune compare una volta per ogni CAP: ne teniamo uno per codice ISTAT.
const byIstat = new Map();
for (const r of rows) {
  if (byIstat.has(r.codice_istat)) continue;
  byIstat.set(r.codice_istat, [
    r.denominazione_ita,
    r.denominazione_altra || '',
    r.sigla_provincia,
    r.denominazione_provincia,
    r.denominazione_regione,
    Number(Number(r.lat).toFixed(4)),
    Number(Number(r.lon).toFixed(4)),
    r.flag_capoluogo === 'SI' ? 1 : 0,
  ]);
}
const comuni = [...byIstat.values()].sort((a, b) => a[0].localeCompare(b[0], 'it'));
const header = ['nome', 'nomeAltro', 'sigla', 'provincia', 'regione', 'lat', 'lon', 'capoluogo'];
writeFileSync(
  new URL('../data/comuni.json', import.meta.url),
  `{"campi":${JSON.stringify(header)},"comuni":[\n${comuni.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`,
);
console.log(`Scritti ${comuni.length} comuni in data/comuni.json`);

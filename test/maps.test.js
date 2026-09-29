import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { discoverPublishers } from '../src/publishers/discover.js';
import { cityFromAddress, parsePlaces, searchGoogleMaps } from '../src/publishers/maps.js';

const fixture = () => readFile(new URL('./fixtures/publishers/google-places.json', import.meta.url), 'utf8');
const piazzola = { name: 'Piazzola sul Brenta', lat: 45.5418, lon: 11.7868 };

test("comune dall'indirizzo di Google", () => {
  assert.equal(cityFromAddress('Via dei Contarini, 12, 35016 Piazzola sul Brenta PD, Italia'), 'Piazzola sul Brenta');
  assert.equal(cityFromAddress('Corso Milano, 40, 35139 Padova PD, Italia'), 'Padova');
  assert.equal(cityFromAddress('Italia'), null);
});

test('Google Maps: attività aperte, entro il raggio, senza catene; si tengono solo nome, sito e comune', async () => {
  const found = parsePlaces(JSON.parse(await fixture()), piazzola, 30);
  assert.deepEqual(
    found.map((p) => p.name),
    ['Edizioni del Brenta', 'Studio Editoriale Punto e Virgola'],
  );
  const [brenta, studio] = found;
  assert.equal(brenta.website, 'https://www.edizionidelbrenta.it/');
  assert.equal(brenta.city, 'Piazzola sul Brenta');
  assert.equal(brenta.distanceKm, 0);
  assert.equal(brenta.kind, 'casa-editrice');
  assert.equal(brenta.source, 'google maps');
  assert.equal(brenta.address, undefined, "l'indirizzo non si conserva");
  assert.equal(brenta.lat, undefined);
  assert.equal(studio.website, null);
  assert.equal(studio.kind, 'studio-editoriale');
  assert.equal(studio.distanceKm, 16);
  // Negli altri settori il tipo è il settore cercato.
  assert.equal(parsePlaces(JSON.parse(await fixture()), piazzola, 30, 'tipografia')[0].kind, 'tipografia');
});

test('Google Maps: senza chiave si salta; la richiesta chiede pochi campi ed è limitata alla zona', async () => {
  assert.deepEqual(await searchGoogleMaps([piazzola], { key: '' }), { results: [], problems: [], skipped: true });

  const requests = [];
  const body = await fixture();
  const found = await searchGoogleMaps([piazzola], {
    key: 'chiave',
    sectors: ['casa-editrice'],
    usageFile: null,
    fetchFn: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.ok(requests.length >= 1);
  const [first] = requests;
  assert.equal(first.url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(first.init.headers['X-Goog-Api-Key'], 'chiave');
  assert.match(first.init.headers['X-Goog-FieldMask'], /places\.websiteUri/);
  assert.doesNotMatch(first.init.headers['X-Goog-FieldMask'], /phone|review|photo/);
  assert.match(first.body.textQuery, /Piazzola sul Brenta/);
  const { low, high } = first.body.locationRestriction.rectangle;
  assert.ok(low.latitude < piazzola.lat && high.latitude > piazzola.lat);
  assert.equal(found.calls, requests.length);
  assert.ok(found.results.some((r) => r.name === 'Edizioni del Brenta'));
});

test('Google Maps: il contatore mensile ferma le ricerche prima della soglia e riparte il mese dopo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gmaps-'));
  const usageFile = path.join(dir, 'usage.json');
  let calls = 0;
  const options = {
    key: 'chiave',
    sectors: ['casa-editrice', 'tipografia'],
    usageFile,
    limit: 3,
    fetchFn: async () => {
      calls++;
      return Response.json({ places: [] });
    },
  };
  const first = await searchGoogleMaps([piazzola], { ...options, now: new Date('2026-09-10') });
  assert.equal(calls, 3);
  assert.match(first.problems[0], /raggiunto il limite di 3 ricerche questo mese/);
  assert.deepEqual(JSON.parse(await readFile(usageFile, 'utf8')), { month: '2026-09', calls: 3 });

  const again = await searchGoogleMaps([piazzola], { ...options, now: new Date('2026-09-20') });
  assert.equal(calls, 3, 'nello stesso mese non si chiama più');
  assert.equal(again.calls, 0);

  await searchGoogleMaps([piazzola], { ...options, now: new Date('2026-10-01') });
  assert.equal(calls, 6, 'il mese dopo si riparte');
});

test('Google Maps: con la chiave rifiutata ci si ferma subito e si spiega cosa controllare', async () => {
  let calls = 0;
  const found = await searchGoogleMaps([piazzola], {
    key: 'sbagliata',
    usageFile: null,
    fetchFn: async () => {
      calls++;
      return Response.json(
        {
          error: { code: 403, message: 'Places API (New) has not been used in project 123 before or it is disabled.' },
        },
        { status: 403 },
      );
    },
  });
  assert.equal(calls, 1);
  assert.match(found.problems[0], /HTTP 403 \(Places API \(New\) has not been used/);
  assert.match(found.problems[1], /"Places API \(New\)" sia attiva/);
});

test('discoverPublishers unisce Google Maps alle altre fonti', async () => {
  const http = {
    busyPause: 0,
    async fetch() {
      return Response.json({ elements: [] });
    },
    async getJson() {
      return { results: { bindings: [] } };
    },
  };
  const noWeb = async () => ({ results: [], problems: [], skipped: true });
  const maps = async (centers, { radiusKm }) => ({
    results: parsePlaces(JSON.parse(await fixture()), centers[0], radiusKm),
    problems: [],
  });
  const found = await discoverPublishers({ osmCache: null, place: 'Piazzola sul Brenta', http, web: noWeb, maps });
  assert.equal(found.googleMaps, true);
  assert.equal(found.webSearch, false);
  assert.ok(found.results.some((r) => r.name === 'Edizioni del Brenta' && r.sources?.includes('google maps')));
});

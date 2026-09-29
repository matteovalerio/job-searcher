import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  analyzeHomepage,
  checkPublisherSite,
  discoverPublishers,
  findEmails,
  mergeResults,
  parseOverpass,
  parseWikidata,
} from '../src/publishers/discover.js';
import { detectSpecialties, guessKind } from '../src/publishers/specialties.js';
import { needsFollowUp, Publishers, publisherKey } from '../src/publishers/store.js';

const fixture = (name) => readFile(new URL(`./fixtures/publishers/${name}`, import.meta.url), 'utf8');
const padova = { name: 'Padova', lat: 45.407, lon: 11.8763 };

test('specializzazioni riconosciute dal testo', () => {
  assert.deepEqual(detectSpecialties('Albi illustrati e narrativa per bambini e ragazzi').slice(0, 2), [
    'bambini',
    'narrativa',
  ]);
  assert.deepEqual(detectSpecialties('Peer review for academic journals, open access'), ['scientifica']);
  assert.deepEqual(detectSpecialties('Pizzeria da Mario'), []);
  assert.equal(guessKind('Studio editoriale Pagine - servizi editoriali'), 'studio-editoriale');
  assert.equal(guessKind('Edizioni Esempio'), 'casa-editrice');
});

test('OpenStreetMap: tiene gli editori, scarta librerie e voci senza nome', async () => {
  const results = parseOverpass(JSON.parse(await fixture('overpass.json')), padova);
  assert.deepEqual(
    results.map((r) => r.name),
    ['Edizioni Esempio', 'Studio Editoriale Pagine', 'Libreria Editrice Il Leggio'],
  );
  const [esempio, studio] = results;
  assert.equal(esempio.website, 'https://www.edizioniesempio.it/');
  assert.equal(esempio.address, 'Via Roma 10, 35122, Padova');
  assert.equal(esempio.distanceKm, 0);
  assert.equal(studio.kind, 'studio-editoriale');
  assert.equal(studio.distanceKm, 30);
});

test('Wikidata: una voce per casa editrice, generi uniti in specializzazioni', async () => {
  const results = parseWikidata(JSON.parse(await fixture('wikidata.json')), padova);
  assert.equal(results.length, 2);
  const scienza = results.find((r) => r.name === 'Casa Editrice Scienza Veneta');
  assert.deepEqual(scienza.specialties.sort(), ['medicina', 'scientifica']);
  assert.equal(scienza.city, 'Vicenza');
  assert.deepEqual(results.find((r) => r.name === 'Edizioni Esempio').specialties, ['bambini', 'narrativa']);
});

test('le due fonti si uniscono per sito e si completano', async () => {
  const osm = parseOverpass(JSON.parse(await fixture('overpass.json')), padova);
  const wd = parseWikidata(JSON.parse(await fixture('wikidata.json')), padova);
  const merged = mergeResults([osm, wd]);
  assert.equal(merged.length, 4);
  const esempio = merged.find((r) => r.name === 'Edizioni Esempio');
  assert.deepEqual(esempio.sources, ['openstreetmap', 'wikidata']);
  assert.equal(esempio.email, 'info@edizioniesempio.it');
  assert.deepEqual(esempio.specialties, ['bambini', 'narrativa']);
  assert.ok(merged[0].distanceKm <= merged.at(-1).distanceKm, 'ordinate per distanza');
});

test('discoverPublishers: interroga le due fonti e riporta i problemi senza fermarsi', async () => {
  const calls = [];
  const http = {
    async request(url, init) {
      calls.push(['osm', url, init.body.slice(0, 20)]);
      return { json: async () => JSON.parse(await fixture('overpass.json')) };
    },
    async getJson(url) {
      calls.push(['wikidata', url.slice(0, 40)]);
      throw new Error('HTTP 429');
    },
  };
  const { center, results, problems } = await discoverPublishers({ place: 'Padova', radiusKm: 40, http });
  assert.equal(center.name, 'Padova');
  assert.equal(results.length, 3);
  assert.deepEqual(problems, ['Wikidata: HTTP 429']);
  assert.match(calls[0][2], /^data=/);
  await assert.rejects(discoverPublishers({ place: 'Atlantide', http }), /Non riconosco il comune/);
});

test('sito della casa editrice: descrizione, specializzazione, email migliore e "lavora con noi"', async () => {
  const html = await fixture('home.html');
  const info = analyzeHomepage(html, 'https://www.edizioniesempio.it/');
  assert.equal(info.description, 'Dal 1985 pubblichiamo albi illustrati e narrativa per bambini e ragazzi.');
  assert.equal(info.specialties[0], 'bambini');
  assert.equal(info.email, 'lavoro@edizioniesempio.it');
  assert.equal(info.jobsEmail, true);
  assert.equal(info.careersUrl, 'https://www.edizioniesempio.it/chi-siamo/lavora-con-noi');
  assert.deepEqual(findEmails(html), [
    'lavoro@edizioniesempio.it',
    'redazione@edizioniesempio.it',
    'info@edizioniesempio.it',
  ]);
  const down = await checkPublisherSite({ website: 'https://x.it' }, async () => {
    throw new Error('HTTP 503');
  });
  assert.deepEqual(down, { problem: 'HTTP 503' });
  assert.deepEqual(await checkPublisherSite({}), { problem: 'nessun sito indicato' });
});

test('archivio: niente doppioni, stati, date di invio e solleciti', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'publishers-'));
  const store = new Publishers(path.join(dir, 'publishers.json'));
  const a = store.add({ name: 'Edizioni Esempio S.r.l.', website: 'edizioniesempio.it' }, '2026-09-01T10:00:00Z');
  assert.equal(a.id, 'edizioni-esempio-s-r-l');
  assert.equal(a.status, 'da_contattare');
  assert.equal(store.add({ name: 'Altro nome', website: 'https://www.edizioniesempio.it/chi-siamo' }), null);
  assert.equal(publisherKey({ name: 'Edizioni Pagine srl' }), publisherKey({ name: 'Pagine' }));
  const found = store.add({ name: 'Pagine', source: 'openstreetmap' });
  assert.equal(found.status, 'da_valutare');

  store.update(a.id, { status: 'inviata', channel: 'email', note: 'CV a redazione@' }, '2026-09-02T09:00:00Z');
  assert.equal(a.sentAt, '2026-09-02');
  assert.equal(a.followUpAt, '2026-09-23');
  assert.equal(needsFollowUp(a, '2026-09-22'), false);
  assert.equal(needsFollowUp(a, '2026-09-23'), true);
  store.update(a.id, { sentAt: '2026-09-05' });
  assert.equal(a.followUpAt, '2026-09-26', 'cambiando la data di invio si sposta il sollecito');
  store.update(a.id, { status: 'sollecitata' }, '2026-09-26T09:00:00Z');
  assert.equal(a.followUpAt, '2026-10-17');
  store.update(a.id, { status: 'colloquio' }, '2026-10-01T09:00:00Z');
  assert.equal(a.followUpAt, null);
  assert.deepEqual(
    a.history.map((h) => h.status),
    ['da_contattare', 'inviata', 'sollecitata', 'colloquio'],
  );
  assert.throws(() => store.update(a.id, { status: 'boh' }), /Stato sconosciuto/);

  store.enrich(found.id, { email: 'info@pagine.it', specialties: ['narrativa'], kind: 'studio-editoriale' });
  assert.equal(found.email, 'info@pagine.it');
  assert.equal(found.kind, 'studio-editoriale');
  store.enrich(found.id, { email: 'altro@pagine.it' });
  assert.equal(found.email, 'info@pagine.it', 'i dati già presenti non si sovrascrivono');
  store.enrich(found.id, { email: 'lavoro@pagine.it', jobsEmail: true });
  assert.equal(found.email, 'lavoro@pagine.it', "tranne l'email generica, se sul sito c'è quella per il lavoro");

  await store.save();
  const again = await new Publishers(store.file).load();
  assert.equal(again.items.length, 2);
  assert.equal(again.find('esempio').id, a.id);
  assert.ok(again.remove(found.id));
  assert.equal(again.list().length, 1);
});

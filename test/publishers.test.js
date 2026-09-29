import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

test('OpenStreetMap: un settore per ogni elemento, le librerie solo se richieste, niente voci senza nome', async () => {
  const json = JSON.parse(await fixture('overpass.json'));
  const results = parseOverpass(json, padova);
  assert.deepEqual(
    results.map((r) => [r.name, r.kind]),
    [
      ['Edizioni Esempio', 'casa-editrice'],
      ['Studio Editoriale Pagine', 'studio-editoriale'],
      ['Libreria Due Torri', 'libreria'],
      ['Libreria Editrice Il Leggio', 'casa-editrice'],
    ],
  );
  assert.deepEqual(
    parseOverpass(json, padova, ['casa-editrice']).map((r) => r.name),
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
  assert.equal(results.length, 2, 'senza gli stampatori storici e senza le voci prive di sito');
  const scienza = results.find((r) => r.name === 'Casa Editrice Scienza Veneta');
  assert.deepEqual(scienza.specialties.sort(), ['medicina', 'scientifica']);
  assert.equal(scienza.city, 'Vicenza');
  assert.deepEqual(results.find((r) => r.name === 'Edizioni Esempio').specialties, ['bambini', 'narrativa']);
});

test('le due fonti si uniscono per sito e si completano', async () => {
  const osm = parseOverpass(JSON.parse(await fixture('overpass.json')), padova);
  const wd = parseWikidata(JSON.parse(await fixture('wikidata.json')), padova);
  const merged = mergeResults([osm, wd]);
  assert.equal(merged.length, 5);
  const esempio = merged.find((r) => r.name === 'Edizioni Esempio');
  assert.deepEqual(esempio.sources, ['openstreetmap', 'wikidata']);
  assert.equal(esempio.email, 'info@edizioniesempio.it');
  assert.deepEqual(esempio.specialties, ['bambini', 'narrativa']);
  assert.ok(merged[0].distanceKm <= merged.at(-1).distanceKm, 'ordinate per distanza');
});

test('discoverPublishers: più città, ricerca web facoltativa, problemi riportati senza fermarsi', async () => {
  const calls = [];
  const http = {
    async fetch(_url, init) {
      calls.push(['osm', init.body.slice(0, 5), init.headers['User-Agent'].startsWith('job-searcher')]);
      return new Response(await fixture('overpass.json'), { headers: { 'content-type': 'application/json' } });
    },
    async getJson() {
      calls.push(['wikidata']);
      throw new Error('HTTP 429');
    },
  };
  const noWeb = async () => ({ results: [], problems: [], skipped: true });
  const one = await discoverPublishers({ osmCache: null, place: 'Padova', radiusKm: 40, http, web: noWeb });
  assert.equal(one.center.name, 'Padova');
  assert.equal(one.results.length, 4);
  assert.deepEqual(one.problems, ['Wikidata (Padova): HTTP 429']);
  assert.equal(one.webSearch, false);
  assert.deepEqual(
    calls.find((c) => c[0] === 'osm'),
    ['osm', 'data=', true],
  );

  const web = async (cities) => ({
    results: [{ name: 'Wetlands', website: 'https://wetlandsbooks.com/', city: 'Venezia', source: 'ricerca web' }],
    problems: [`cercate: ${cities.join(', ')}`],
  });
  const two = await discoverPublishers({ osmCache: null, place: 'Padova, Venezia', radiusKm: 40, http, web });
  assert.deepEqual(
    two.centers.map((c) => c.name),
    ['Padova', 'Venezia'],
  );
  assert.equal(two.webSearch, true);
  assert.ok(two.problems.includes('cercate: Padova, Venezia'));
  assert.ok(two.results.some((r) => r.name === 'Wetlands'));
  // Lo studio di Vicenza (30 km da Padova) resta a 30 km: la distanza è dal centro più vicino.
  assert.equal(two.results.find((r) => r.name === 'Studio Editoriale Pagine').distanceKm, 30);
  await assert.rejects(
    discoverPublishers({ osmCache: null, place: 'Atlantide', http, web: noWeb }),
    /Non riconosco il comune/,
  );
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

test('pulizia: via le voci di Wikidata senza sito mai toccate', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'publishers-'));
  const store = new Publishers(path.join(dir, 'publishers.json'));
  store.add({ name: 'Stamperia del Seicento', source: 'wikidata', city: 'Venezia' });
  store.add({ name: 'Marsilio', source: 'wikidata', website: 'marsilioeditori.it' });
  const noted = store.add({ name: 'Tipografia con nota', source: 'wikidata' });
  store.update(noted.id, { note: 'da chiedere a Anna' });
  const contacted = store.add({ name: 'Editore contattato', source: 'wikidata' });
  store.update(contacted.id, { status: 'inviata' });
  store.add({ name: 'Aggiunto a mano senza sito' });
  assert.deepEqual(
    store.staleFromWikidata().map((p) => p.name),
    ['Stamperia del Seicento'],
  );
});

test('Overpass: se un server rifiuta si prova il successivo; se falliscono tutti, si dice perché', async () => {
  const { fetchOverpass } = await import('../src/publishers/discover.js');
  const urls = ['https://uno.example/api/interpreter', 'https://due.example/api/interpreter', 'https://tre.example/x'];
  const tried = [];
  const ok = await fetchOverpass('[out:json];', {
    urls,
    fetchFn: async (url) => {
      tried.push(new URL(url).host);
      if (url.includes('uno'))
        return new Response('<html><body><p>Not Acceptable: identify your client</p></body></html>', { status: 406 });
      return Response.json({ elements: [{ type: 'node', tags: { name: 'X' } }] });
    },
  });
  assert.deepEqual(tried, ['uno.example', 'due.example']);
  assert.equal(ok.elements.length, 1);

  await assert.rejects(
    fetchOverpass('[out:json];', {
      urls,
      fetchFn: async (url) => {
        if (url.includes('uno')) return new Response('Not Acceptable', { status: 406 });
        if (url.includes('due')) return Response.json({ elements: [], remark: 'runtime error: Query timed out' });
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      },
    }),
    /uno\.example: HTTP 406 \(Not Acceptable\) \| due\.example: runtime error: Query timed out \| tre\.example: ECONNREFUSED/,
  );
  // Query sbagliata (400): inutile riprovare sugli altri server.
  const calls = [];
  await assert.rejects(
    fetchOverpass('boh', {
      urls,
      fetchFn: async (url) => {
        calls.push(url);
        return new Response('parse error', { status: 400 });
      },
    }),
    /HTTP 400/,
  );
  assert.equal(calls.length, 1);
});

test('Overpass sovraccarico (504 open64): pausa e nuovo tentativo sullo stesso server', async () => {
  const { fetchOverpass } = await import('../src/publishers/discover.js');
  let calls = 0;
  const json = await fetchOverpass('[out:json];', {
    urls: ['https://uno.example/api/interpreter', 'https://due.example/api/interpreter'],
    busyPause: 0,
    fetchFn: async () => {
      calls++;
      if (calls === 1) return new Response('Error: runtime error: open64: 0 Success', { status: 504 });
      return Response.json({ elements: [] });
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(json.elements, []);
});

test('OpenStreetMap un settore alla volta: se uno fallisce gli altri arrivano; dopo due fallimenti ci si ferma', async () => {
  const bodies = [];
  const http = {
    busyPause: 0,
    async fetch(_url, init) {
      const q = decodeURIComponent(init.body);
      bodies.push(q);
      if (q.includes('advertising_agency')) return new Response('bad gateway', { status: 502 });
      return Response.json({
        elements: [
          { type: 'node', lat: 45.42, lon: 11.88, tags: { name: 'Tipografia Veneta', craft: 'printer' } },
          { type: 'node', lat: 46.5, lon: 11.35, tags: { name: 'Tipografia Lontana', craft: 'printer' } },
        ],
      });
    },
    async getJson() {
      return { results: { bindings: [] } };
    },
  };
  const noWeb = async () => ({ results: [], problems: [], skipped: true });
  const found = await discoverPublishers({
    osmCache: null,
    place: 'Padova',
    radiusKm: 30,
    sectors: ['agenzia-comunicazione', 'tipografia'],
    http,
    web: noWeb,
  });
  assert.deepEqual(
    found.results.map((r) => r.name),
    ['Tipografia Veneta'],
    'la tipografia oltre il raggio (Bolzano) si scarta',
  );
  assert.equal(found.problems.length, 1);
  assert.match(found.problems[0], /agenzie pubblicitarie e di comunicazione\): nessun server ha risposto/);

  const down = await discoverPublishers({
    osmCache: null,
    place: 'Padova',
    sectors: ['agenzia-comunicazione', 'tipografia', 'libreria'],
    http: { ...http, fetch: async () => new Response('down', { status: 503 }) },
    web: noWeb,
  });
  assert.equal(down.problems.length, 3);
  assert.match(down.problems[2], /gli altri settori non sono stati cercati/);
});

test('OpenStreetMap: la stessa ricerca entro 24 ore usa la memoria, senza interrogare i server', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'osm-cache-'));
  let calls = 0;
  const http = {
    async fetch() {
      calls++;
      return Response.json({
        elements: [{ type: 'node', lat: 45.41, lon: 11.88, tags: { name: 'Tipografia Veneta', craft: 'printer' } }],
      });
    },
    async getJson() {
      return { results: { bindings: [] } };
    },
  };
  const noWeb = async () => ({ results: [], problems: [], skipped: true });
  const run = () =>
    discoverPublishers({ place: 'Padova', sectors: ['tipografia'], http, web: noWeb, osmCache: cacheDir });
  const first = await run();
  const second = await run();
  assert.equal(calls, 1);
  assert.deepEqual(
    second.results.map((r) => r.name),
    first.results.map((r) => r.name),
  );
});

test('Overpass: il server che risponde si prova per primo, quelli muti si saltano; errori senza intestazione', async () => {
  const { fetchOverpass, overpassServers } = await import('../src/publishers/discover.js');
  const urls = ['https://uno.example/x', 'https://due.example/x', 'https://tre.example/x'];
  const servers = overpassServers();
  const tried = [];
  const fetchFn = async (url) => {
    const host = new URL(url).host;
    tried.push(host);
    if (host === 'uno.example') throw Object.assign(new Error('scaduto'), { name: 'TimeoutError' });
    if (host === 'due.example')
      return new Response(
        'OSM3S Response The data included in this document is from www.openstreetmap.org. The data is made available under ODbL. Error : runtime error: open64: 0 Success',
        { status: 504 },
      );
    return Response.json({ elements: [] });
  };
  await fetchOverpass('[out:json];', { urls, fetchFn, servers, busyPause: 0 });
  assert.deepEqual(tried, ['uno.example', 'due.example', 'due.example', 'tre.example']);
  tried.length = 0;
  await fetchOverpass('[out:json];', { urls, fetchFn, servers, busyPause: 0 });
  assert.deepEqual(tried, ['tre.example'], 'il secondo settore va subito al server che ha risposto');

  const err = await fetchOverpass('[out:json];', { urls: [urls[1]], fetchFn, busyPause: 0 }).catch((e) => e);
  assert.equal(
    err.message,
    'nessun server ha risposto. due.example: HTTP 504 (Error : runtime error: open64: 0 Success)',
  );
});

test('OpenStreetMap: se i server non rispondono si usano i risultati salvati, con un avviso', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'osm-stale-'));
  let up = true;
  const http = {
    busyPause: 0,
    async fetch() {
      if (!up) return new Response('down', { status: 503 });
      return Response.json({
        elements: [{ type: 'node', lat: 45.41, lon: 11.88, tags: { name: 'Tipografia Veneta', craft: 'printer' } }],
      });
    },
    async getJson() {
      return { results: { bindings: [] } };
    },
  };
  const noWeb = async () => ({ results: [], problems: [], skipped: true });
  const run = () =>
    discoverPublishers({ place: 'Padova', sectors: ['tipografia'], http, web: noWeb, osmCache: cacheDir });
  await run();
  // La memoria ha più di 24 ore: si interroga il server, che però è giù.
  const [file] = await readdir(cacheDir);
  const saved = JSON.parse(await readFile(path.join(cacheDir, file), 'utf8'));
  await writeFile(path.join(cacheDir, file), JSON.stringify({ ...saved, at: '2026-01-10T10:00:00Z' }));
  up = false;
  const realNow = Date.now;
  Date.now = () => new Date('2026-01-20T10:00:00Z').getTime();
  try {
    const found = await run();
    assert.deepEqual(
      found.results.map((r) => r.name),
      ['Tipografia Veneta'],
    );
    assert.match(found.problems[0], /uso i risultati salvati il 10\/01\/2026/);
  } finally {
    Date.now = realNow;
  }
});

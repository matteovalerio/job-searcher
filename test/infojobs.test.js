import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import infojobs, { buildUrl, parse } from '../src/sources/infojobs.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/infojobs/${name}`, import.meta.url), 'utf8');
const BASE = 'https://www.infojobs.it/offerte-lavoro?keyword=redattore&location=Padova';

test('infojobs: URL di ricerca, anche personalizzato', () => {
  const url = new URL(buildUrl({ keyword: 'correttore di bozze', target: { place: 'Padova' } }));
  assert.equal(url.searchParams.get('keyword'), 'correttore di bozze');
  assert.equal(url.searchParams.get('location'), 'Padova');
  const custom = buildUrl({
    keyword: 'redattore',
    target: { place: 'Vicenza', infojobsUrl: 'https://www.infojobs.it/lavoro/{keyword}/{place}' },
  });
  assert.equal(custom, 'https://www.infojobs.it/lavoro/redattore/Vicenza');
});

test('infojobs: dati strutturati JSON-LD', () => {
  const [a, b] = parse(fixture('jsonld.html'), BASE);
  assert.deepEqual(
    [a.title, a.company, a.location, a.url, a.postedAt],
    [
      'Redattrice editoriale',
      'CLEUP',
      'Padova, Veneto',
      'https://www.infojobs.it/padova/redattrice-editoriale/of-i0a1b2c3d4e5f',
      '2026-09-20T00:00:00.000Z',
    ],
  );
  assert.equal(b.company, 'Edizioni Berica');
  assert.equal(b.remote, true);
});

test('infojobs: dati della pagina (__NEXT_DATA__)', () => {
  const jobs = parse(fixture('nextdata.html'), BASE);
  assert.deepEqual(
    jobs.map((j) => [j.title, j.company, j.location]),
    [
      ['Assistente editoriale', 'Il Poligrafo', 'Padova'],
      ['Impaginatore InDesign', 'Grafiche Venete', 'Vicenza'],
    ],
  );
  assert.equal(jobs[0].url, 'https://www.infojobs.it/padova/assistente-editoriale/of-iabc123abc123');
  assert.equal(jobs[1].remote, null);
});

test('infojobs: link alle offerte come ultima risorsa', () => {
  const jobs = parse(fixture('links.html'), BASE);
  assert.equal(jobs.length, 1, "il link all'azienda non è un'offerta");
  assert.deepEqual(
    [jobs[0].title, jobs[0].company, jobs[0].location, jobs[0].url],
    [
      'Redattore junior',
      'Edizioni Messaggero',
      'Padova',
      'https://www.infojobs.it/padova/redattore-junior/of-i9988776655aa',
    ],
  );
});

test('infojobs: se non riconosce nulla salva la pagina e lo segnala', async () => {
  const warnings = [];
  const saved = [];
  const source = {
    ...infojobs,
    openBrowser: async () => ({
      load: async () => {},
      content: async () => '<html>nuovo layout</html>',
      close: async () => {},
    }),
    saveDebugPage: async (name, html) => {
      saved.push(html);
      return `.job-searcher/debug/${name}.html`;
    },
  };
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };
  try {
    const jobs = await source.search({
      keywords: ['redattore'],
      target: { place: 'Padova' },
      warn: (w) => warnings.push(w),
    });
    assert.deepEqual(jobs, []);
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
  assert.equal(saved.length, 1);
  assert.match(warnings[0], /pagina salvata in \.job-searcher\/debug\/infojobs\.html/);
});

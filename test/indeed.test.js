import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import indeed, { buildUrl, parseHtml, parseMosaic } from '../src/sources/indeed.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('indeed: URL per area e per remoto', () => {
  const area = new URL(buildUrl({ keyword: 'redattore', target: { type: 'area', place: 'Padova', radiusKm: 35 } }));
  assert.equal(area.host, 'it.indeed.com');
  assert.equal(area.searchParams.get('q'), 'redattore');
  assert.equal(area.searchParams.get('l'), 'Padova');
  assert.equal(area.searchParams.get('radius'), '35');
  assert.equal(area.searchParams.get('fromage'), null, 'oltre 14 giorni filtra il programma');

  const remote = new URL(buildUrl({ keyword: 'editor', target: { type: 'remote' }, maxAgeDays: 7, page: 2 }));
  assert.equal(remote.searchParams.get('l'), '');
  assert.ok(remote.searchParams.get('remotejob'));
  assert.equal(remote.searchParams.get('fromage'), '7');
  assert.equal(remote.searchParams.get('start'), '20');
});

test('indeed: dati incorporati nella pagina', () => {
  const [local, remote] = parseMosaic(JSON.parse(fixture('indeed-mosaic.json')));
  assert.equal(local.id, 'indeed:a1b2c3d4e5f60708');
  assert.equal(local.title, 'Redattore/Redattrice editoriale');
  assert.equal(local.company, 'Piccin Nuova Libraria S.p.A.');
  assert.equal(local.url, 'https://it.indeed.com/viewjob?jk=a1b2c3d4e5f60708');
  assert.equal(local.salary, '1.600 € - 1.900 € al mese');
  assert.match(local.description, /riviste scientifiche/);
  assert.equal(local.remote, null);
  assert.equal(remote.remote, true);
});

test("indeed: schede lette dall'HTML se mancano i dati incorporati", () => {
  const [job] = parseHtml(fixture('indeed.html'));
  assert.equal(job.title, 'Assistente editoriale');
  assert.equal(job.company, 'Neri Pozza Editore');
  assert.equal(job.location, 'Vicenza, Veneto');
  assert.match(job.description, /rapporti con gli autori/);
});

test('indeed: pagine successive fino a esaurimento e browser sempre chiuso', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (fn) => (fn(), 0));
  const loaded = [];
  let closed = false;
  const full = { metaData: { mosaicProviderJobCardsModel: { results: [] } } };
  for (let i = 0; i < 10; i++)
    full.metaData.mosaicProviderJobCardsModel.results.push({ jobkey: `k${i}`, title: `Editor ${i}` });
  const source = {
    ...indeed,
    openBrowser: async () => ({
      load: async (url) => {
        loaded.push(new URL(url).searchParams.get('start'));
        return loaded.length === 1 ? { data: full } : { data: null, html: fixture('indeed.html') };
      },
      close: async () => {
        closed = true;
      },
    }),
  };
  const jobs = await source.search({ keywords: ['editor'], target: { type: 'remote' }, maxPages: 3 });
  assert.deepEqual(loaded, [null, '10']);
  assert.equal(jobs.length, 11);
  assert.ok(closed);
});

test('indeed è attiva solo se richiesta', () => {
  const base = { keywords: ['editor'], targets: [{ type: 'remote' }] };
  const names = (profile, opts) => resolveProfile(profile, opts).targets[0].sources.map((s) => s.name);
  assert.ok(!names(base).includes('indeed'));
  assert.ok(names({ ...base, enableSources: ['indeed'] }).includes('indeed'));
  assert.deepEqual(names(base, { onlySources: ['indeed'] }), ['indeed']);
});

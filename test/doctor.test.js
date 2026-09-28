import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hintFor, runDoctor } from '../src/doctor.js';
import { HttpError } from '../src/http.js';
import { makeJob } from '../src/job.js';

const source = (name, fields) => ({ name, label: name, supports: ['area', 'remote'], ...fields });

test('doctor: stato di ogni fonte, con la ricerca minima', async () => {
  const calls = [];
  const sources = [
    source('ok', {
      search: async (ctx) => {
        calls.push(ctx);
        return [makeJob('ok', { title: 'Redattrice', company: 'Piccin', location: 'Padova' })];
      },
      enrich: async (job) => ({ ...job, description: 'Revisione bozze' }),
    }),
    source('vuota', { search: async () => [] }),
    source('rotta', {
      search: async () => {
        throw new HttpError(403, 'https://x');
      },
    }),
    source('chiave', { env: ['JOB_SEARCHER_TEST_NO_KEY'], search: async () => [] }),
  ];
  const seen = [];
  const results = await runDoctor(sources, { keyword: 'redattore', onResult: (r) => seen.push(r.source) });

  assert.deepEqual(seen, ['ok', 'vuota', 'rotta', 'chiave']);
  assert.deepEqual(
    results.map((r) => r.status),
    ['ok', 'empty', 'error', 'skipped'],
  );
  assert.equal(results[0].count, 1);
  assert.deepEqual(results[0].sample, ['Redattrice · Piccin · Padova']);
  assert.equal(results[0].detail, 'dettagli ok');
  assert.match(results[1].hint, /potrebbe essere cambiato/);
  assert.match(results[2].hint, /blocca le richieste/);
  assert.match(results[3].message, /JOB_SEARCHER_TEST_NO_KEY/);
  // una sola parola, un solo luogo, una sola pagina
  assert.deepEqual(calls[0].keywords, ['redattore']);
  assert.equal(calls[0].maxPages, 1);
  assert.equal(calls[0].target.place, 'Padova');
});

test('doctor: usa il primo target compatibile del profilo, ridotto al minimo', async () => {
  const calls = [];
  const remoteOnly = source('remota', {
    supports: ['remote'],
    search: async (ctx) => (calls.push(ctx), []),
  });
  const profile = {
    targets: [
      { type: 'area', places: [{ name: 'Vicenza', lat: 45.5, lon: 11.5 }], queryKeywords: ['redattrice'] },
      { type: 'remote', queryKeywords: ['copy editor'], linkedinLocations: ['Italia', 'Unione Europea'] },
    ],
  };
  await runDoctor([remoteOnly, source('area', { search: async (ctx) => (calls.push(ctx), []) })], { profile });
  assert.deepEqual(calls[0].keywords, ['copy editor']);
  assert.deepEqual(calls[0].target.linkedinLocations, ['Italia']);
  assert.deepEqual(calls[1].keywords, ['redattrice']);
  assert.equal(calls[1].target.place, 'Vicenza');
});

test('doctor: tempo scaduto e suggerimenti', async () => {
  const slow = source('lenta', { search: () => new Promise(() => {}) });
  const [r] = await runDoctor([slow], { timeoutMs: 20 });
  assert.equal(r.status, 'error');
  assert.match(r.hint, /troppo lentamente/);

  const keyed = { env: ['ADZUNA_APP_KEY'] };
  assert.match(hintFor(new HttpError(401, 'u'), keyed), /ADZUNA_APP_KEY/);
  assert.match(hintFor(new HttpError(404, 'u'), {}), /indirizzo della fonte è cambiato/);
  assert.match(hintFor(new HttpError(429, 'u'), {}), /troppe richieste/);
  assert.match(hintFor(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), {}), /rete/);
});

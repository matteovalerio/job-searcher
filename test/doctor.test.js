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

test('doctor: con un profilo conta le offerte pertinenti e, se in zona non trova nulla, riprova col remoto', async () => {
  const { resolveProfile } = await import('../src/config.js');
  const profile = resolveProfile({
    keywords: ['editor', 'redattore'],
    targets: [
      { type: 'area', place: 'Padova', searchKeywords: ['redattore'] },
      { type: 'remote', searchKeywords: ['editor'] },
    ],
  });
  const calls = [];
  const international = source('ats', {
    search: async ({ keywords, target }) => {
      calls.push([keywords[0], target.type]);
      if (target.type === 'area') return []; // "redattore" su un sito in inglese
      return [
        makeJob('ats', { title: 'Copy Editor', location: 'Remote - Europe', remote: true }),
        makeJob('ats', { title: 'Sales Manager', location: 'Remote - Europe', remote: true }),
      ];
    },
  });
  const pages = source('editori', {
    resolved: new Map([['Piccin', { url: 'https://piccin.it/lavora-con-noi', via: 'mappa del sito' }]]),
    search: async () => [
      makeJob('editori', { title: 'Catalogo' }),
      makeJob('editori', { title: 'Redattore', location: 'Padova' }),
    ],
  });
  const [ats, careers] = await runDoctor([international, pages], { profile });
  assert.deepEqual(calls, [
    ['redattore', 'area'],
    ['editor', 'remote'],
  ]);
  assert.equal(ats.query, '"redattore" a Padova, poi "editor" full remote');
  assert.deepEqual([ats.count, ats.relevant, ats.sample[0]], [2, 1, 'Copy Editor · Remote - Europe']);
  assert.deepEqual([careers.count, careers.relevant, careers.sample[0]], [2, 1, 'Redattore · Padova']);
  assert.deepEqual(careers.pages, ['Piccin: https://piccin.it/lavora-con-noi (mappa del sito)']);
});

test('formato della risposta: lista vuota ok, lista mancante è un errore chiaro', async () => {
  const { expectList } = await import('../src/sources/shape.js');
  assert.deepEqual(expectList({ jobs: [] }, ['jobs']), { jobs: [] });
  assert.deepEqual(expectList([], ['']), []);
  assert.throws(
    () => expectList({ totalCount: 0, message: 'Invalid key' }, ['jobs']),
    /formato inatteso \(manca "jobs"; campi presenti: totalCount, message\)\. Messaggio del servizio: "Invalid key"/,
  );
  assert.match(hintFor(new Error('risposta in un formato inatteso (manca "jobs")'), {}), /cambiato formato/);
});

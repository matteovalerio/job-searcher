import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyOverrides, loadProfile, resolveProfile } from '../src/config.js';
import { makeJob } from '../src/job.js';
import { renderCsv } from '../src/output/csv.js';
import { renderHtml } from '../src/output/html.js';
import { runSearch } from '../src/search.js';
import { SeenStore } from '../src/store.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');

function fakeSource(name, supports, jobsFor) {
  return { name, label: name, supports, search: async (ctx) => jobsFor(ctx) };
}

test('il profilo di esempio è valido', async () => {
  const profile = resolveProfile(await loadProfile('profiles/redattore-padova.json'));
  const [padova, remote] = profile.targets;
  assert.equal(padova.place, 'Padova');
  assert.ok(padova.sources.some((s) => s.name === 'linkedin'));
  assert.ok(!padova.sources.some((s) => s.name === 'remotive'), "le fonti solo-remote non servono per un'area");
  assert.ok(remote.sources.some((s) => s.name === 'remotive'));
  assert.ok(remote.keywords.includes('redattore') && remote.keywords.includes('copy editor'));
  assert.deepEqual(remote.queryKeywords, ['editor', 'copy editor', 'proofreader', 'redattore']);
});

test('opzioni da CLI: parole chiave, luogo e remoto sostituiscono il profilo', async () => {
  const base = await loadProfile('profiles/redattore-padova.json');
  const p = resolveProfile(
    applyOverrides(base, { keywords: ['traduttore'], place: 'Verona', radiusKm: 20, remote: true }),
  );
  assert.deepEqual(
    p.targets.map((t) => [t.type, t.place, t.radiusKm]),
    [
      ['area', 'Verona', 20],
      ['remote', undefined, undefined],
    ],
  );
  assert.deepEqual(p.targets[0].keywords, ['traduttore']);
  assert.throws(() => resolveProfile(applyOverrides({}, { keywords: ['x'] })), /Nessun target/);
  assert.throws(
    () => resolveProfile(applyOverrides({}, { keywords: ['x'], remote: true }), { onlySources: ['boh'] }),
    /sconosciuta/,
  );
});

test('runSearch: filtra, unisce, ordina e isola gli errori delle fonti', async () => {
  const good = fakeSource('good', ['area'], ({ keywords, target }) => [
    makeJob('good', { id: 1, title: 'Redattore', company: 'Libri Srl', url: 'https://1', postedAt: '2026-09-10' }),
    makeJob('good', {
      id: 2,
      title: 'Redattore casa editrice',
      company: 'Pagine',
      url: 'https://2',
      postedAt: '2026-09-20',
    }),
    makeJob('good', { id: 3, title: 'Cuoco', url: 'https://3' }),
    makeJob('good', { id: 4, title: `ricerca ${keywords.join('+')} a ${target.place}`, url: 'https://4' }),
  ]);
  const broken = fakeSource('broken', ['area'], () => {
    throw new Error('HTTP 403');
  });
  const needsKey = { ...fakeSource('keyed', ['area'], () => []), env: ['JOB_SEARCHER_TEST_MISSING_KEY'] };

  const [result] = await runSearch(
    {
      name: 't',
      targets: [
        {
          id: 'pd',
          label: 'PD',
          type: 'area',
          place: 'Padova',
          keywords: ['redattore'],
          queryKeywords: ['redattore'],
          excludeKeywords: [],
          boostKeywords: ['casa editrice'],
          matchIn: 'title',
          maxAgeDays: 30,
          sources: [good, broken, needsKey],
        },
      ],
    },
    { now: NOW },
  );
  assert.deepEqual(
    result.jobs.map((j) => j.title),
    // a parità di punteggio vince la più recente; quelle senza data vanno in fondo
    ['Redattore casa editrice', 'Redattore', 'ricerca redattore a Padova'],
  );
  assert.deepEqual(result.stats.good, { fetched: 4, kept: 3 });
  assert.equal(result.stats.broken.error, 'HTTP 403');
  assert.match(result.stats.keyed.skipped, /JOB_SEARCHER_TEST_MISSING_KEY/);
});

test("SeenStore segna le offerte nuove tra un'esecuzione e l'altra", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'job-searcher-'));
  const first = await SeenStore.forProfile('Redattore casa editrice', dir).load();
  const jobs = [{ id: 'a' }, { id: 'b' }];
  first.mark(jobs, '2026-09-01');
  await first.save();
  assert.ok(first.file.endsWith('seen-redattore-casa-editrice.json'));
  assert.deepEqual(JSON.parse(await readFile(first.file, 'utf8')), { a: '2026-09-01', b: '2026-09-01' });

  const second = await SeenStore.forProfile('Redattore casa editrice', dir).load();
  const again = [{ id: 'a' }, { id: 'c' }];
  second.mark(again, '2026-09-02');
  assert.deepEqual(
    again.map((j) => [j.id, j.isNew, j.firstSeen]),
    [
      ['a', false, '2026-09-01'],
      ['c', true, '2026-09-02'],
    ],
  );
});

test('report: CSV con escape e HTML senza iniezioni', () => {
  const results = [
    {
      target: { label: 'PD' },
      stats: { x: { fetched: 1, kept: 1 } },
      jobs: [
        {
          ...makeJob('x', { url: 'https://e' }),
          title: 'Redattore, "junior" <script>',
          score: 10,
          matched: ['redattore'],
          boosted: [],
          isNew: true,
        },
      ],
    },
  ];
  assert.match(renderCsv(results), /"Redattore, ""junior"" <script>"/);
  const html = renderHtml(results);
  assert.ok(html.includes('Redattore, &quot;junior&quot; &lt;script&gt;'));
  assert.ok(!html.includes('<script>"'));
});

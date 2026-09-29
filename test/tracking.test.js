import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { makeJob } from '../src/job.js';
import { findInLastResults, loadLastResults, saveLastResults, shortId, Tracking } from '../src/tracking.js';

const job = (title) =>
  makeJob('linkedin', { id: title, title, company: 'Piccin', location: 'Padova', url: `https://x/${title}` });

async function withHome(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'home-'));
  const previous = process.env.JOB_SEARCHER_HOME;
  process.env.JOB_SEARCHER_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.JOB_SEARCHER_HOME;
    else process.env.JOB_SEARCHER_HOME = previous;
  }
}

test('id breve: stabile e di 7 caratteri', () => {
  assert.equal(shortId('linkedin:123'), shortId({ id: 'linkedin:123' }));
  assert.match(shortId('linkedin:123'), /^[0-9a-f]{7}$/);
  assert.notEqual(shortId('linkedin:1'), shortId('linkedin:2'));
});

test('stati, note, cronologia, ricerca per id breve/url, rimozione', async () => {
  await withHome(async () => {
    const t = await new Tracking().load();
    const a = job('Redattrice');
    t.set(a, { status: 'interessante' }, '2026-09-01T00:00:00Z');
    t.set(a, { status: 'candidatura', note: 'CV inviato' }, '2026-09-02T00:00:00Z');
    t.set(a, { note: 'richiamare' }, '2026-09-03T00:00:00Z'); // solo nota: lo stato resta
    await t.save();

    const loaded = await new Tracking().load();
    const item = loaded.find(shortId(a));
    assert.equal(item.status, 'candidatura');
    assert.equal(item.note, 'richiamare');
    assert.deepEqual(
      item.history.map((h) => h.status),
      ['interessante', 'candidatura'],
    );
    assert.equal(loaded.find('https://x/Redattrice').job.title, 'Redattrice');
    assert.throws(() => loaded.set(a, { status: 'boh' }), /Stato sconosciuto "boh"/);
    assert.ok(loaded.remove(a.id));
    assert.equal(loaded.find(shortId(a)), null);
  });
});

test('elenco ordinato per stato e annotazione dei risultati (le scartate spariscono)', async () => {
  await withHome(async () => {
    const t = new Tracking();
    const [a, b, c] = [job('A'), job('B'), job('C')];
    t.set(a, { status: 'interessante' });
    t.set(b, { status: 'colloquio' });
    t.set(c, { status: 'scartata' });
    assert.deepEqual(
      t.list().map((i) => i.job.title),
      ['A', 'B', 'C'],
    );
    assert.deepEqual(
      t.list({ status: 'colloquio' }).map((i) => i.job.title),
      ['B'],
    );

    const results = [{ target: { label: 'Z' }, jobs: [a, b, c, job('D')].map((j) => ({ ...j })) }];
    assert.equal(t.annotate(results), 1);
    assert.deepEqual(
      results[0].jobs.map((j) => [j.title, j.tracking?.label ?? null, j.shortId.length]),
      [
        ['A', 'interessante', 7],
        ['B', 'colloquio', 7],
        ['D', null, 7],
      ],
    );
  });
});

test("ultimi risultati: salvati per profilo e usati per ritrovare un'offerta", async () => {
  await withHome(async () => {
    const d = job('Editor');
    await saveLastResults('prova', [{ target: { id: 'r', label: 'Remoto', type: 'remote' }, jobs: [d], stats: {} }], {
      name: 'Prova',
    });
    const last = await loadLastResults('prova');
    assert.equal(last.name, 'Prova');
    assert.equal(last.targets[0].jobs[0].title, 'Editor');
    assert.equal((await findInLastResults(shortId(d))).title, 'Editor');
    assert.equal(await findInLastResults('0000000'), null);
    assert.equal(await loadLastResults('nessuno'), null);
  });
});

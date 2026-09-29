import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeFileAtomic } from '../src/atomic.js';
import { Tracking } from '../src/tracking.js';

test('salvataggi contemporanei dello stesso file: nessun errore, vince l’ultimo, niente file temporanei', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'atomic-'));
  const file = path.join(dir, 'tracking.json');
  // Come due richieste dell'interfaccia web nello stesso processo (prima: ENOENT su rename).
  const saves = Array.from({ length: 10 }, (_, i) => {
    const t = new Tracking(file);
    t.set({ id: `job-${i}`, title: `Offerta ${i}` });
    return t.save();
  });
  await Promise.all(saves);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(saved), ['job-9']);
  assert.deepEqual(await readdir(dir), ['tracking.json']);

  await Promise.all([writeFileAtomic(file, 'a'), writeFileAtomic(file, 'b')]);
  assert.equal(await readFile(file, 'utf8'), 'b');
});

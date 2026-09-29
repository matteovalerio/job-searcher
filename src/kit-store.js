import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';
import { stateDir } from './paths.js';
import { shortId, Tracking } from './tracking.js';

/*
 * Archivio dei kit di candidatura: .job-searcher/kits.json, un kit per offerta. È separato dalle candidature:
 * aprire il kit di un'offerta non vuol dire seguirla. La candidatura nasce solo quando si sceglie uno stato
 * (o si segna la candidatura come inviata).
 */

export class KitStore {
  constructor(file = stateDir('kits.json')) {
    this.file = file;
    this.items = {};
  }

  async load() {
    try {
      this.items = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  async save() {
    await writeFileAtomic(this.file, `${JSON.stringify(this.items, null, 2)}\n`);
  }

  get(jobId) {
    return this.items[jobId] ?? null;
  }

  /** Cerca per id, id breve o indirizzo dell'offerta. */
  find(ref) {
    return (
      Object.values(this.items).find(
        (k) => k.job && (k.job.id === ref || shortId(k.job.id) === ref || k.job.url === ref),
      ) ?? null
    );
  }

  set(job, kit, now = new Date().toISOString()) {
    this.items[job.id] = { ...kit, updatedAt: now };
    return this.items[job.id];
  }

  remove(jobId) {
    const had = Boolean(this.items[jobId]);
    delete this.items[jobId];
    return had;
  }

  ids() {
    return Object.keys(this.items);
  }
}

/**
 * Le versioni precedenti salvavano il kit dentro la candidatura, e aprire il kit bastava a creare una candidatura
 * "interessante". Qui i kit passano in kits.json e le candidature create solo dal kit (nessun cambio di stato,
 * nessuna nota, create insieme al kit) si tolgono. Le altre restano come sono.
 * @returns {Promise<{ moved: number, removed: number }>}
 */
export async function migrateKits(tracking, kits) {
  let moved = 0;
  let removed = 0;
  for (const item of Object.values(tracking.items)) {
    if (!item.kit) continue;
    const { kit } = item;
    if (!kits.get(item.job.id)) kits.set(item.job, kit, kit.updatedAt);
    moved++;
    delete item.kit;
    const onlyByKit =
      item.status === 'interessante' &&
      !item.note &&
      item.history.length <= 1 &&
      Math.abs(Date.parse(item.createdAt) - Date.parse(kit.createdAt ?? item.createdAt)) < 60000;
    if (onlyByKit) {
      tracking.remove(item.job.id);
      removed++;
    }
  }
  if (moved) await Promise.all([kits.save(), tracking.save()]);
  return { moved, removed };
}

/** Candidature e kit, caricati (e sistemati se servono). */
export async function loadTrackingAndKits() {
  const [tracking, kits] = await Promise.all([new Tracking().load(), new KitStore().load()]);
  await migrateKits(tracking, kits);
  return { tracking, kits };
}

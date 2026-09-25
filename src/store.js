import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Memoria delle offerte già viste tra un'esecuzione e l'altra, per evidenziare le nuove.
 * Salvata in .job-searcher/seen-<profilo>.json nella cartella corrente.
 */
export class SeenStore {
  constructor(file) {
    this.file = file;
    this.seen = {};
  }

  static forProfile(profileName, dir = '.job-searcher') {
    const slug =
      profileName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
    return new SeenStore(path.join(dir, `seen-${slug}.json`));
  }

  async load() {
    try {
      this.seen = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  /** Marca ogni offerta con isNew/firstSeen e registra quelle nuove. */
  mark(jobs, now = new Date().toISOString()) {
    for (const job of jobs) {
      job.isNew = !this.seen[job.id];
      job.firstSeen = this.seen[job.id] ?? now;
      this.seen[job.id] = job.firstSeen;
    }
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.seen, null, 1));
  }
}

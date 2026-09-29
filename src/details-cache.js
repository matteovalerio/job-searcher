import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';

/*
 * Memoria dei dettagli scaricati (descrizione e criteri) delle offerte, per le fonti che nei risultati non danno
 * il testo (LinkedIn). Le ricerche di ogni giorno scaricano così solo le offerte nuove: meno attesa e meno
 * richieste. File: .job-searcher/details-cache.json; le voci più vecchie di 45 giorni si tolgono.
 */

const KEEP_DAYS = 45;

export class DetailsCache {
  constructor(file) {
    this.file = file;
    this.items = {};
    this.changed = false;
  }

  async load() {
    try {
      this.items = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  get(id) {
    return this.items[id] ?? null;
  }

  set(id, { description, tags }, now = new Date()) {
    this.items[id] = { description: description ?? '', tags: tags ?? [], at: now.toISOString() };
    this.changed = true;
  }

  async save(now = Date.now()) {
    if (!this.changed) return;
    const limit = now - KEEP_DAYS * 86400000;
    for (const [id, item] of Object.entries(this.items)) if (Date.parse(item.at) < limit) delete this.items[id];
    await writeFileAtomic(this.file, JSON.stringify(this.items));
    this.changed = false;
  }
}

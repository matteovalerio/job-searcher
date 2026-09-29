import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';
import { stateDir } from './paths.js';

/*
 * Candidature: per ogni offerta seguita si salvano lo stato, una nota, la cronologia e una copia dei dati
 * principali (così resta consultabile anche quando l'offerta sparisce dai portali).
 * File: .job-searcher/tracking.json. Lo usano sia la riga di comando ("track") sia l'interfaccia web.
 */

export const STATUSES = {
  interessante: 'interessante',
  candidatura: 'candidatura inviata',
  colloquio: 'colloquio',
  offerta: 'offerta ricevuta',
  rifiutata: 'non selezionata',
  nessuna: 'nessuna risposta',
  scartata: 'non mi interessa',
};

// Solleciti: il primo una settimana dopo l'invio, il secondo dieci giorni dopo il primo. Poi basta: se non
// rispondono ancora, conviene segnare "nessuna risposta".
export const FOLLOW_UP_DAYS = [7, 10];

const day = (iso) => iso.slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(`${day(date)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d.toISOString());
};

/** Stati che tolgono l'offerta dai risultati delle ricerche successive (e dalle notifiche). */
export const HIDDEN_STATUSES = ['scartata', 'rifiutata'];

/** Identificativo breve e stabile di un'offerta, da usare nei comandi: "track a1b2c3d candidatura". */
export function shortId(jobOrId) {
  const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;
  return createHash('sha1').update(id).digest('hex').slice(0, 7);
}

const snapshot = (job) => ({
  id: job.id,
  title: job.title,
  company: job.company,
  location: job.location,
  url: job.url,
  source: job.source,
  postedAt: job.postedAt,
  ...(job.score != null ? { score: job.score } : {}),
  ...(job.info ? { info: job.info } : {}),
});

export class Tracking {
  constructor(file = stateDir('tracking.json')) {
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
    // Scrittura atomica: il file è condiviso tra riga di comando e interfaccia web.
    await writeFileAtomic(this.file, `${JSON.stringify(this.items, null, 2)}\n`);
  }

  get(jobId) {
    return this.items[jobId] ?? null;
  }

  /** Cerca per id breve, id completo o indirizzo dell'offerta. */
  find(ref) {
    return Object.values(this.items).find((t) => t.shortId === ref || t.job.id === ref || t.job.url === ref) ?? null;
  }

  /**
   * Imposta stato e/o nota di un'offerta.
   * @param {object} job  l'offerta (serve la prima volta; poi basta l'id)
   */
  set(job, { status, note, sentAt } = {}, now = new Date().toISOString()) {
    if (status && !STATUSES[status]) {
      throw new Error(`Stato sconosciuto "${status}". Stati: ${Object.keys(STATUSES).join(', ')}`);
    }
    const current = this.items[job.id] ?? { shortId: shortId(job), job: snapshot(job), history: [], createdAt: now };
    if (status && status !== current.status) current.history.push({ status, at: now });
    this.items[job.id] = {
      ...current,
      job: { ...current.job, ...snapshot(job) },
      status: status ?? current.status ?? 'interessante',
      note: note ?? current.note ?? '',
      updatedAt: now,
    };
    if (!current.history.length) this.items[job.id].history.push({ status: this.items[job.id].status, at: now });
    const item = this.items[job.id];
    // Candidatura inviata: si programma il primo sollecito. Con qualsiasi altro stato i solleciti si fermano.
    if (status === 'candidatura' && current.status !== 'candidatura') {
      item.sentAt = sentAt ?? day(now);
      item.followUps = [];
      item.followUpAt = addDays(item.sentAt, FOLLOW_UP_DAYS[0]);
    } else if (status && status !== 'candidatura') {
      item.followUpAt = null;
    }
    if (status === 'candidatura' && sentAt && sentAt !== item.sentAt) {
      item.sentAt = sentAt;
      item.followUpAt = addDays(sentAt, FOLLOW_UP_DAYS[0]);
    }
    return item;
  }

  /** Segna un sollecito inviato e programma il successivo (se ce n'è ancora uno). */
  followedUp(jobId, now = new Date().toISOString()) {
    const item = this.items[jobId];
    if (!item) throw new Error('Offerta non seguita');
    if (item.status !== 'candidatura') throw new Error('I solleciti servono per le candidature inviate');
    item.followUps = [...(item.followUps ?? []), day(now)];
    const next = FOLLOW_UP_DAYS[item.followUps.length];
    item.followUpAt = next ? addDays(now, next) : null;
    item.history.push({ status: item.status, at: now, note: `sollecito ${item.followUps.length} inviato` });
    item.updatedAt = now;
    return item;
  }

  /**
   * Data e dettagli del colloquio: { at: data e ora ISO, mode: 'in presenza'|'online'|'telefono', where, with }.
   * Segnarlo porta la candidatura allo stato "colloquio" (se non c'è già o non è più avanti).
   */
  setInterview(job, interview, now = new Date().toISOString()) {
    if (interview?.at && Number.isNaN(Date.parse(interview.at))) throw new Error('Data del colloquio non valida');
    const item = this.items[job.id] ?? this.set(job, {}, now);
    if (!['colloquio', 'offerta'].includes(item.status)) this.set(job, { status: 'colloquio' }, now);
    const current = this.items[job.id];
    current.interview = interview?.at
      ? { at: interview.at, mode: interview.mode || null, where: interview.where || null, with: interview.with || null }
      : null;
    current.updatedAt = now;
    return current;
  }

  /** Colloqui da oggi in poi, dal più vicino. */
  upcomingInterviews(now = new Date().toISOString()) {
    return this.list()
      .filter((t) => t.interview?.at && t.interview.at >= day(now))
      .sort((a, b) => a.interview.at.localeCompare(b.interview.at));
  }

  /** Candidature da sollecitare oggi (o in ritardo). */
  due(now = new Date().toISOString()) {
    return this.list().filter((t) => t.status === 'candidatura' && t.followUpAt && t.followUpAt <= day(now));
  }

  remove(jobId) {
    const had = Boolean(this.items[jobId]);
    delete this.items[jobId];
    return had;
  }

  /** Elenco ordinato: prima gli stati più avanzati, poi gli aggiornamenti più recenti. */
  list({ status } = {}) {
    const order = Object.keys(STATUSES);
    return Object.values(this.items)
      .filter((t) => !status || t.status === status)
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Aggiunge a ogni offerta dei risultati il suo id breve e lo stato; toglie quelle nascoste. */
  annotate(results) {
    let hidden = 0;
    for (const r of results) {
      r.jobs = r.jobs.filter((job) => {
        job.shortId = shortId(job);
        const t = this.items[job.id];
        if (t) {
          job.tracking = { status: t.status, label: STATUSES[t.status], note: t.note };
          if (HIDDEN_STATUSES.includes(t.status)) {
            hidden++;
            return false;
          }
        }
        return true;
      });
    }
    return hidden;
  }
}

/* Ultimi risultati di ogni profilo: servono a "track <id>" per ritrovare un'offerta e all'interfaccia web. */

const resultsFile = (profileId) => stateDir(`results-${profileId}.json`);

export async function saveLastResults(profileId, results, { name, date = new Date() } = {}) {
  const data = {
    profile: profileId,
    name,
    date: date.toISOString(),
    targets: results.map(({ target, jobs, stats, rejected = [] }) => ({
      target: { id: target.id, label: target.label, type: target.type },
      stats,
      jobs,
      rejected: rejected.map((j) => ({ ...snapshot(j), rejected: j.rejected })),
    })),
  };
  await mkdir(stateDir(), { recursive: true });
  await writeFile(resultsFile(profileId), JSON.stringify(data));
  return data;
}

export async function loadLastResults(profileId) {
  try {
    return JSON.parse(await readFile(resultsFile(profileId), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Il profilo dai cui ultimi risultati viene un'offerta (serve per i dati del mercato), oppure null. */
export async function profileOfJob(ref) {
  let files = [];
  try {
    files = (await readdir(stateDir())).filter((f) => /^results-.*\.json$/.test(f));
  } catch {
    return null;
  }
  for (const file of files) {
    const data = JSON.parse(await readFile(stateDir(file), 'utf8'));
    if (data.targets.some((t) => t.jobs.some((j) => shortId(j) === ref || j.id === ref || j.url === ref))) {
      return file.replace(/^results-|\.json$/g, '');
    }
  }
  return null;
}

/** Cerca un'offerta (per id breve, id o indirizzo) negli ultimi risultati di tutti i profili. */
export async function findInLastResults(ref) {
  let files = [];
  try {
    files = (await readdir(stateDir())).filter((f) => /^results-.*\.json$/.test(f));
  } catch {
    return null;
  }
  for (const file of files) {
    const data = JSON.parse(await readFile(stateDir(file), 'utf8'));
    for (const t of data.targets) {
      const job = t.jobs.find((j) => shortId(j) === ref || j.id === ref || j.url === ref);
      if (job) return job;
    }
  }
  return null;
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateDir } from '../paths.js';
import { slugify } from '../profiles/store.js';
import { normalize } from '../text.js';

/*
 * Case editrici e studi editoriali da contattare, con lo stato della candidatura spontanea.
 * File: .job-searcher/publishers.json, condiviso da riga di comando e interfaccia web.
 */

export const PUBLISHER_STATUSES = {
  da_valutare: 'da valutare',
  da_contattare: 'da contattare',
  inviata: 'candidatura inviata',
  sollecitata: 'sollecito inviato',
  colloquio: 'colloquio',
  rifiutata: 'risposta negativa',
  nessuna_risposta: 'nessuna risposta',
  scartata: 'non mi interessa',
};

/** Giorni dopo cui conviene sollecitare una candidatura senza risposta. */
export const FOLLOW_UP_DAYS = 21;

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (isoDate, days) => new Date(new Date(isoDate).getTime() + days * DAY).toISOString().slice(0, 10);

/** Chiave per riconoscere la stessa casa editrice: il dominio del sito, altrimenti il nome. */
export function publisherKey(p) {
  if (p.website) {
    try {
      return new URL(p.website).host.replace(/^www\./, '');
    } catch {
      // sito scritto male: si usa il nome
    }
  }
  return normalize(p.name)
    .replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|editore|editrice|edizioni|casa editrice)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Indirizzo del sito con lo schema, es. "www.esempio.it" -> "https://www.esempio.it/". */
export function normalizeWebsite(url) {
  if (!url) return null;
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

/** Serve un sollecito? Candidatura inviata (o già sollecitata) senza risposta dopo la data prevista. */
export function needsFollowUp(p, now = today()) {
  return ['inviata', 'sollecitata'].includes(p.status) && Boolean(p.followUpAt) && p.followUpAt <= now;
}

export class Publishers {
  constructor(file = stateDir('publishers.json')) {
    this.file = file;
    this.items = [];
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
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.items, null, 2)}\n`);
    await rename(tmp, this.file);
  }

  get(id) {
    return this.items.find((p) => p.id === id) ?? null;
  }

  /** Cerca per id, oppure per nome (anche parziale, se non è ambiguo). */
  find(ref) {
    const exact = this.get(ref);
    if (exact) return exact;
    const q = normalize(ref);
    const matches = this.items.filter((p) => normalize(p.name).includes(q));
    return matches.length === 1 ? matches[0] : null;
  }

  has(p) {
    const key = publisherKey(p);
    return this.items.some((i) => publisherKey(i) === key);
  }

  /**
   * Aggiunge una casa editrice. Restituisce null se c'è già (stesso sito o stesso nome).
   * @param {object} p  { name, website?, city?, kind?, email?, specialties?, note?, source? }
   */
  add(p, now = new Date().toISOString()) {
    if (!p.name?.trim()) throw new Error('Serve il nome della casa editrice.');
    const item = {
      name: p.name.trim(),
      kind: p.kind ?? 'casa-editrice',
      website: normalizeWebsite(p.website),
      city: p.city ?? null,
      address: p.address ?? null,
      lat: p.lat ?? null,
      lon: p.lon ?? null,
      distanceKm: p.distanceKm ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      careersUrl: p.careersUrl ?? null,
      description: p.description ?? null,
      specialties: p.specialties ?? [],
      source: p.source ?? 'manuale',
      status: p.status ?? (p.source && p.source !== 'manuale' ? 'da_valutare' : 'da_contattare'),
      sentAt: null,
      followUpAt: null,
      channel: null,
      contact: p.contact ?? null,
      note: p.note ?? '',
      history: [],
      addedAt: now,
      updatedAt: now,
    };
    if (this.has(item)) return null;
    let id = slugify(item.name) || 'editore';
    for (let n = 2; this.get(id); n++) id = `${slugify(item.name)}-${n}`;
    item.id = id;
    item.history.push({ status: item.status, at: now });
    this.items.push(item);
    return item;
  }

  /**
   * Cambia stato e dati della candidatura. Passando a "inviata" si segna la data di invio (oggi, se non
   * indicata) e quella del sollecito; passando a "sollecitata" si sposta il sollecito successivo.
   */
  update(id, patch = {}, now = new Date().toISOString()) {
    const p = this.get(id);
    if (!p) throw new Error(`Casa editrice "${id}" non trovata.`);
    const { status, ...fields } = patch;
    if (status && !PUBLISHER_STATUSES[status]) {
      throw new Error(`Stato sconosciuto "${status}". Stati: ${Object.keys(PUBLISHER_STATUSES).join(', ')}`);
    }
    const allowed = [
      'name',
      'kind',
      'website',
      'city',
      'email',
      'phone',
      'careersUrl',
      'contact',
      'channel',
      'note',
      'sentAt',
      'followUpAt',
      'specialties',
      'description',
    ];
    for (const key of allowed)
      if (key in fields) p[key] = key === 'website' ? normalizeWebsite(fields[key]) : fields[key];
    const day = now.slice(0, 10);
    if (status && status !== p.status) {
      p.status = status;
      p.history.push({ status, at: now, ...(fields.note ? { note: fields.note } : {}) });
      if (status === 'inviata') {
        p.sentAt = fields.sentAt ?? p.sentAt ?? day;
        p.followUpAt = fields.followUpAt ?? addDays(p.sentAt, FOLLOW_UP_DAYS);
      }
      if (status === 'sollecitata') p.followUpAt = fields.followUpAt ?? addDays(day, FOLLOW_UP_DAYS);
      if (!['inviata', 'sollecitata'].includes(status) && !('followUpAt' in fields)) p.followUpAt = null;
    } else if ('sentAt' in fields && p.status === 'inviata' && !('followUpAt' in fields) && fields.sentAt) {
      p.followUpAt = addDays(fields.sentAt, FOLLOW_UP_DAYS);
    }
    p.updatedAt = now;
    return p;
  }

  /** Aggiunge dati trovati sul sito senza sovrascrivere quelli scritti a mano. */
  enrich(id, found, now = new Date().toISOString()) {
    const p = this.get(id);
    if (!p) throw new Error(`Casa editrice "${id}" non trovata.`);
    for (const key of ['email', 'phone', 'careersUrl', 'description', 'city'])
      if (!p[key] && found[key]) p[key] = found[key];
    // L'indirizzo per le candidature trovato sul sito vale più di quello generico preso dalle mappe.
    if (found.jobsEmail && p.source !== 'manuale') p.email = found.email;
    if (!p.specialties.length && found.specialties?.length) p.specialties = found.specialties;
    if (found.kind && p.kind === 'casa-editrice' && found.kind !== p.kind) p.kind = found.kind;
    p.checkedAt = now;
    p.checkProblem = found.problem ?? null;
    return p;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((p) => p.id !== id);
    return this.items.length < before;
  }

  /** Elenco: prima i solleciti scaduti, poi per stato, poi per nome. */
  list({ status } = {}) {
    const order = Object.keys(PUBLISHER_STATUSES);
    return this.items
      .filter((p) => !status || p.status === status)
      .sort(
        (a, b) =>
          needsFollowUp(b) - needsFollowUp(a) ||
          order.indexOf(a.status) - order.indexOf(b.status) ||
          a.name.localeCompare(b.name, 'it'),
      );
  }
}

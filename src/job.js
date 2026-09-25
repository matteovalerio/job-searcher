import { htmlToText, toIsoDate, truncate } from './text.js';

/**
 * @typedef {object} Job
 * @property {string} id          identificativo univoco "fonte:id"
 * @property {string} source      nome della fonte (es. "linkedin")
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {boolean|null} remote  true se full remote, null se non si sa
 * @property {string} url
 * @property {string|null} postedAt data ISO di pubblicazione
 * @property {string} description testo semplice (troncato)
 * @property {string} salary
 * @property {string[]} tags
 */

/** Costruisce un Job normalizzato a partire dai campi grezzi di una fonte. */
export function makeJob(source, fields) {
  const url = String(fields.url ?? '').trim();
  const rawId = fields.id ?? url ?? `${fields.title}|${fields.company}`;
  return {
    id: `${source}:${rawId}`,
    source,
    title: htmlToText(fields.title ?? '').trim(),
    company: htmlToText(fields.company ?? '').trim(),
    location: htmlToText(fields.location ?? '').trim(),
    remote: fields.remote ?? null,
    url,
    postedAt: toIsoDate(fields.postedAt),
    description: truncate(htmlToText(fields.description ?? ''), 1500),
    salary: String(fields.salary ?? '').trim(),
    tags: (fields.tags ?? []).filter(Boolean).map(String),
  };
}

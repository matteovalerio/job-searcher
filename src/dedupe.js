import { normalize } from './text.js';

const COMPANY_SUFFIXES = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|ltd|llc|inc|gmbh|srl|spa)\b\.?/g;

export function dedupeKey(job) {
  const title = normalize(job.title)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const company = normalize(job.company)
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return `${title}|${company}`;
}

/**
 * Unisce le offerte duplicate (stesso titolo e azienda, anche da fonti diverse).
 * Tiene la prima e registra le altre in `alsoOn`.
 */
export function dedupe(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...job, alsoOn: [] });
    } else if (job.url !== existing.url && !existing.alsoOn.some((o) => o.url === job.url)) {
      existing.alsoOn.push({ source: job.source, url: job.url });
    }
  }
  return [...byKey.values()];
}

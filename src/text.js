import * as cheerio from 'cheerio';

/** Minuscolo, senza accenti, spazi compattati: "Redattrice Città" -> "redattrice citta". */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compila una parola chiave in una RegExp che la cerca come parola intera.
 * Un "*" finale indica un prefisso: "redatt*" trova "redattore", "redattrice", ...
 */
export function compileKeyword(keyword) {
  const norm = normalize(keyword);
  const prefix = norm.endsWith('*');
  const body = escapeRegExp(prefix ? norm.slice(0, -1) : norm).replace(/ /g, '[\\s\\-/]+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`, 'u');
}

/** Restituisce le parole chiave (originali) presenti nel testo già normalizzato. */
export function findKeywords(normalizedText, compiled) {
  return compiled.filter(({ re }) => re.test(normalizedText)).map(({ keyword }) => keyword);
}

export function compileKeywords(keywords = []) {
  return keywords.map((keyword) => ({ keyword, re: compileKeyword(keyword) }));
}

/** Converte HTML in testo semplice. */
export function htmlToText(html) {
  if (!html) return '';
  if (!/[<&]/.test(html)) return String(html).replace(/\s+/g, ' ').trim();
  const $ = cheerio.load(`<div>${html}</div>`);
  $('br, p, li, div').after(' ');
  return $.root().text().replace(/\s+/g, ' ').trim();
}

export function truncate(text, max = 400) {
  if (!text || text.length <= max) return text ?? '';
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** Converte date in vari formati (ISO, RFC 822, epoch in s o ms) in ISO string o null. */
export function toIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  let d;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    d = new Date(value);
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Sostituisce {segnaposto} in un template di URL, con encoding. */
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));
}

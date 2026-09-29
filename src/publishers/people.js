import * as cheerio from 'cheerio';
import { getText } from '../http.js';
import { htmlToText, normalize } from '../text.js';

/*
 * La persona giusta a cui scrivere: dalle pagine "chi siamo", "redazione", "team" e "contatti" del sito di
 * un'azienda si ricavano nomi e ruoli (direzione editoriale, caporedattore, risorse umane…), con l'email
 * personale se c'è. Si usa solo il sito dell'azienda: niente social. Un nome si prende solo se accanto c'è un
 * ruolo riconosciuto, così non si scambiano per persone i titoli dei libri o i nomi degli autori.
 */

// Ruoli, dal più utile per una candidatura (0) al meno utile. Il testo è già normalizzato (minuscolo, senza accenti).
// biome-ignore format: tabella
const ROLES = [
  [0, /risorse umane|human resources|\bhr\b|ufficio (del )?personale|recruit|selezione del personale|talent acquisition/],
  [1, /direttore editoriale|direttrice editoriale|direzione editoriale|caporedattore|caporedattrice|capo ?redattore|capo ?redattrice|responsabile (della )?redazione|responsabile editoriale|coordinamento editoriale|coordinat(ore|rice) editoriale|managing editor|editor in chief|editorial director|publishing director/],
  [2, /\beditore\b|(?<!casa )\beditrice\b|fondat(ore|rice)|founder|titolare|amministrat(ore|rice)|\bceo\b|diret(tore|trice) generale|presidente|\bpublisher\b/],
  [3, /redattore|redattrice|\beditor\b|redazione|ufficio stampa|segreteria (di )?redazione|art director|grafic[oa]|impaginat|traduttor[ei]|traduttrice/],
  [4, /responsabile|diret(tore|trice)|ufficio|marketing|commerciale|amministrazione/],
];

/** Ruolo riconosciuto in un testo breve, con la sua importanza, oppure null. */
export function roleOf(text) {
  const t = normalize(text);
  if (!t || t.length > 80) return null;
  for (const [rank, re] of ROLES) if (re.test(t)) return { role: text.replace(/\s+/g, ' ').trim(), rank };
  return null;
}

// Parole con la maiuscola che non sono nomi di persona.
// biome-ignore format: elenco
const NOT_NAME = new Set(['casa', 'editrice', 'edizioni', 'editore', 'redazione', 'chi', 'siamo', 'contatti', 'contatto', 'team', 'staff', 'ufficio', 'direttore', 'direttrice', 'responsabile', 'direzione', 'libri', 'libro', 'catalogo', 'collana', 'collane', 'novita', 'news', 'home', 'privacy', 'cookie', 'policy', 'via', 'piazza', 'corso', 'srl', 'spa', 'italia', 'padova', 'venezia', 'vicenza', 'milano', 'roma', 'lavora', 'con', 'noi', 'about', 'us', 'our', 'the', 'studio', 'agenzia', 'societa', 'gruppo', 'group', 'press', 'books', 'editoriale', 'editor', 'marketing', 'ufficio stampa', 'segreteria', 'amministrazione', 'orari', 'telefono', 'email', 'fax', 'partita', 'iva']);
const TITLE = /^(?:dott\.?(?:ssa)?|dr\.?|prof\.?(?:ssa)?|sig\.?(?:ra)?|ing\.?|avv\.?)\s+/i;
const NAME =
  /^[A-ZÀ-Ý][a-zà-ÿ'’]+(?:\s+(?:de|di|da|del|dal|della|dalla|van|von|la|lo|le|li)\b)?(?:\s+[A-ZÀ-Ý][a-zà-ÿ'’]+){1,2}$/u;

/** Il nome di una persona ("Maria Rossi", "dott.ssa Anna De Luca"), oppure null. */
export function nameOf(text) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TITLE, '');
  if (!NAME.test(t)) return null;
  const words = normalize(t).split(' ');
  if (words.some((w) => NOT_NAME.has(w)) || roleOf(t)) return null;
  return t;
}

const SEPARATOR = /\s*(?:\s[–—-]\s|[–—|:,(]|\)\s*)\s*/;

/** Persone in una pagina: coppie nome-ruolo sulla stessa riga o su righe vicine (schede del team). */
export function extractPeople(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const emails = $('a[href^="mailto:"]')
    .map((_, el) => decodeURIComponent($(el).attr('href').slice(7).split('?')[0]).trim().toLowerCase())
    .get();
  const text = htmlToText($('body').html() ?? $.root().html() ?? '');
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) emails.push(m[0].toLowerCase());
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && l.length <= 160);

  const found = [];
  const add = (name, role) => found.push({ name, role: role.role, rank: role.rank });
  for (const [i, line] of lines.entries()) {
    const parts = line.split(SEPARATOR).filter(Boolean);
    let matched = false;
    // "Maria Rossi – Direttrice editoriale", "Caporedattore: Luca Bianchi", "Anna Verdi (ufficio stampa)"
    for (let j = 0; j + 1 < parts.length && !matched; j++) {
      const [a, b] = [parts[j], parts[j + 1]];
      const name = nameOf(a);
      const role = roleOf(b);
      if (name && role) {
        add(name, role);
        matched = true;
        continue;
      }
      const role2 = roleOf(a);
      const name2 = nameOf(b);
      if (role2 && name2) {
        add(name2, role2);
        matched = true;
      }
    }
    if (matched) continue;
    // Schede: il nome su una riga e il ruolo sulla successiva (o prima).
    const name = nameOf(line);
    if (!name) continue;
    const role = roleOf(lines[i + 1] ?? '') ?? roleOf(lines[i - 1] ?? '');
    if (role) add(name, role);
  }

  // Email personali: quella che contiene il cognome (o nome e cognome) della persona.
  const personal = [...new Set(emails)].filter((e) => !/@(example|esempio)\./.test(e));
  for (const p of found) {
    const parts = normalize(p.name)
      .replace(/[^a-z ]/g, '')
      .split(' ')
      .filter((w) => w.length > 2);
    const surname = parts.at(-1);
    const email = personal.find(
      (e) =>
        surname &&
        e
          .split('@')[0]
          .replace(/[^a-z]/g, '')
          .includes(surname),
    );
    if (email) p.email = email;
  }
  return mergePeople(found);
}

/** Una voce per persona (stesso nome), con il ruolo più utile; dal più utile al meno. */
export function mergePeople(list) {
  const byName = new Map();
  for (const p of list) {
    const key = normalize(p.name);
    const prev = byName.get(key);
    if (!prev || p.rank < prev.rank) byName.set(key, { ...prev, ...p, email: p.email ?? prev?.email });
    else if (!prev.email && p.email) prev.email = p.email;
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

const TEAM_LINK =
  /chi[\s_-]*siamo|about|team|staff|redazione|la[\s_-]*casa[\s_-]*editrice|contatt|contact|organigramma|persone|people|who[\s_-]*we[\s_-]*are|storia/;

/** Le pagine del sito dove di solito ci sono le persone (stesso sito, al massimo `max`). */
export function teamLinks(html, baseUrl, max = 3) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set();
  const out = [];
  for (const el of $('a[href]').toArray()) {
    const text = normalize($(el).text());
    const href = $(el).attr('href');
    if (!TEAM_LINK.test(text) && !TEAM_LINK.test(normalize(href))) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.host !== base.host || !/^https?:$/.test(url.protocol)) continue;
    url.hash = '';
    if (url.href === base.href || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push(url.href);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Cerca le persone sul sito di un'azienda: la home e fino a tre pagine "chi siamo/redazione/contatti".
 * @returns {Promise<{ people: object[], pages: string[], problem?: string }>}
 */
export async function findPeople(website, fetchText = getText) {
  if (!website) return { people: [], pages: [], problem: 'nessun sito indicato' };
  let home;
  try {
    home = await fetchText(website, { timeoutMs: 20000 });
  } catch (err) {
    return { people: [], pages: [], problem: err.message };
  }
  const pages = [website];
  const found = extractPeople(home).map((p) => ({ ...p, source: website }));
  for (const url of teamLinks(home, website)) {
    try {
      const html = await fetchText(url, { timeoutMs: 20000 });
      pages.push(url);
      found.push(...extractPeople(html).map((p) => ({ ...p, source: url })));
    } catch {
      // pagina non raggiungibile: si prova la successiva
    }
  }
  return { people: mergePeople(found).slice(0, 8), pages };
}

/** La persona a cui indirizzare una candidatura: la più utile, se il suo ruolo c'entra (personale o direzione). */
export function bestContact(people = []) {
  return people.find((p) => p.rank <= 2) ?? null;
}

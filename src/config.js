import { readFile } from 'node:fs/promises';
import { builtinSources, createCustomSource } from './sources/index.js';

/**
 * @typedef {object} TargetConfig
 * @property {string} [id]
 * @property {string} [label]
 * @property {'area'|'remote'} type   "area" = zona geografica, "remote" = full remote
 * @property {string} [place]         località (per type "area"), es. "Padova"
 * @property {string} [country]       codice paese ISO, es. "it" (usato da Adzuna)
 * @property {number} [radiusKm]
 * @property {string[]} [keywords]    parole chiave aggiuntive per questo target
 * @property {string[]} [searchKeywords] parole da cercare sui portali (default: tutte le keywords)
 * @property {string[]} [excludeKeywords]
 * @property {string[]} [boostKeywords]
 * @property {string[]} [sources]     fonti da usare (default: tutte quelle compatibili)
 * @property {string[]} [acceptedRegions] per "remote": restrizioni geografiche accettate
 *
 * @typedef {TargetConfig & { id: string, label: string, keywords: string[], excludeKeywords: string[],
 *   boostKeywords: string[], matchIn: string, maxAgeDays: number, maxPages: number, sources: object[] }} ResolvedTarget
 */

const unique = (list) => [
  ...new Set(
    list
      .filter(Boolean)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

export async function loadProfile(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`Impossibile leggere il profilo "${file}": ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Il profilo "${file}" non è JSON valido: ${err.message}`);
  }
}

/** Applica le opzioni da riga di comando sopra (o al posto di) un profilo. */
export function applyOverrides(profile = {}, opts = {}) {
  const p = structuredClone(profile);
  p.name ??= 'ricerca';
  p.targets ??= [];
  if (opts.keywords?.length) {
    p.keywords = opts.keywords;
    delete p.searchKeywords;
    for (const t of p.targets) {
      delete t.keywords;
      delete t.searchKeywords;
    }
  }
  if (opts.exclude?.length) p.excludeKeywords = unique([...(p.excludeKeywords ?? []), ...opts.exclude]);
  if (opts.maxAgeDays) p.maxAgeDays = opts.maxAgeDays;
  if (opts.place || opts.remote) {
    // Località/remoto indicati da CLI sostituiscono i target del profilo.
    p.targets = [];
    if (opts.place) {
      p.targets.push({ type: 'area', place: opts.place, radiusKm: opts.radiusKm ?? 30, country: opts.country ?? 'it' });
    }
    if (opts.remote) p.targets.push({ type: 'remote' });
  } else if (opts.radiusKm) {
    for (const t of p.targets) if (t.type === 'area') t.radiusKm = opts.radiusKm;
  }
  return p;
}

/**
 * Valida il profilo e calcola, per ogni target, parole chiave e fonti effettive.
 * @returns {{ name: string, targets: ResolvedTarget[] }}
 */
export function resolveProfile(profile, { onlySources } = {}) {
  const custom = (profile.customSources ?? []).map(createCustomSource);
  const all = [...builtinSources, ...custom];
  const byName = new Map(all.map((s) => [s.name, s]));

  const unknown = (onlySources ?? []).filter((name) => !byName.has(name));
  if (unknown.length) {
    throw new Error(`Fonte sconosciuta "${unknown.join(', ')}". Disponibili: ${[...byName.keys()].join(', ')}`);
  }

  if (!profile.targets?.length) {
    throw new Error('Nessun target: indica una località (--place) e/o --remote, oppure dei "targets" nel profilo');
  }

  const targets = profile.targets.map((t, i) => {
    if (t.type !== 'area' && t.type !== 'remote') {
      throw new Error(`Target #${i + 1}: "type" deve essere "area" o "remote"`);
    }
    if (t.type === 'area' && !t.place) throw new Error(`Target #${i + 1}: manca "place"`);

    const keywords = unique([...(profile.keywords ?? []), ...(t.keywords ?? [])]);
    if (!keywords.length) throw new Error('Serve almeno una parola chiave ("keywords" o --keywords)');

    let sources;
    if (t.sources) {
      sources = t.sources.map((name) => {
        const s = byName.get(name);
        if (!s) throw new Error(`Fonte sconosciuta "${name}". Disponibili: ${[...byName.keys()].join(', ')}`);
        return s;
      });
    } else {
      sources = all;
    }
    sources = sources.filter((s) => s.supports.includes(t.type));
    if (onlySources?.length) sources = sources.filter((s) => onlySources.includes(s.name));

    return {
      ...t,
      id: t.id ?? (t.type === 'remote' ? 'remote' : t.place.toLowerCase()),
      label: t.label ?? (t.type === 'remote' ? 'Full remote' : `${t.place} (+${t.radiusKm ?? 30} km)`),
      keywords,
      // Parole inviate ai portali (di solito poche e generiche); tutte le "keywords" servono poi al filtro.
      // Le parole con "*" restano solo nel filtro locale: i portali non capiscono i caratteri jolly.
      queryKeywords: unique(t.searchKeywords ?? profile.searchKeywords ?? keywords).filter((k) => !k.includes('*')),
      excludeKeywords: unique([...(profile.excludeKeywords ?? []), ...(t.excludeKeywords ?? [])]),
      boostKeywords: unique([...(profile.boostKeywords ?? []), ...(t.boostKeywords ?? [])]),
      matchIn: t.matchIn ?? profile.matchIn ?? 'title+description',
      maxAgeDays: t.maxAgeDays ?? profile.maxAgeDays ?? 30,
      maxPages: t.maxPages ?? profile.maxPages ?? 2,
      minScore: t.minScore ?? profile.minScore,
      sources,
    };
  });

  return { name: profile.name ?? 'ricerca', targets };
}

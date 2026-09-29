import { findComune } from './geo.js';
import { affineForProfile } from './publishers/sectors.js';
import { builtinSources, createCustomSource } from './sources/index.js';

/**
 * @typedef {object} TargetConfig
 * @property {string} [id]
 * @property {string} [label]
 * @property {'area'|'remote'} type   "area" = zona geografica, "remote" = full remote
 * @property {string} [place]         località (per type "area"), es. "Padova"
 * @property {string[]} [places]      più località, es. ["Padova", "Vicenza"] (in alternativa a place)
 * @property {string} [country]       codice paese ISO, es. "it" (usato da Adzuna)
 * @property {number} [radiusKm]
 * @property {string[]} [keywords]    parole chiave aggiuntive per questo target
 * @property {string[]} [relatedKeywords] ruoli affini: bastano per tenere un'offerta ma valgono meno punti
 * @property {string[]} [languages]   lingue conosciute: si scartano le offerte che nel titolo ne chiedono altre
 * @property {object} [filters]        livello, esperienza, contratto e stipendio: maxYearsRequired, excludeSeniority,
 *                                     excludeContracts, minSalary (lordo annuo), salaryCurrency (default "EUR")
 * @property {string[]} [searchKeywords] parole da cercare sui portali (default: tutte le keywords)
 * @property {string[]} [excludeKeywords]
 * @property {string[]} [boostKeywords]
 * @property {string[]} [sources]     fonti da usare (default: tutte quelle compatibili)
 * @property {string[]} [acceptedRegions] per "remote": restrizioni geografiche accettate
 * @property {'drop'|'keep'} [unknownLocation] per "area": cosa fare delle offerte con località non riconosciuta
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

export { loadProfile } from './profiles/store.js';

/** Applica le opzioni da riga di comando sopra (o al posto di) un profilo. */
export function applyOverrides(profile = {}, opts = {}) {
  const p = structuredClone(profile);
  p.name ??= 'ricerca';
  p.targets ??= [];
  if (opts.keywords?.length) {
    p.keywords = opts.keywords;
    delete p.searchKeywords;
    delete p.relatedKeywords;
    for (const t of p.targets) {
      delete t.keywords;
      delete t.searchKeywords;
      delete t.relatedKeywords;
    }
  }
  if (opts.exclude?.length) p.excludeKeywords = unique([...(p.excludeKeywords ?? []), ...opts.exclude]);
  if (opts.maxAgeDays) p.maxAgeDays = opts.maxAgeDays;
  if (opts.place || opts.remote) {
    // Località/remoto indicati da CLI sostituiscono i target del profilo.
    p.targets = [];
    if (opts.place) {
      p.targets.push({
        type: 'area',
        places: opts.place.split(',').map((s) => s.trim()),
        radiusKm: opts.radiusKm ?? 30,
        country: opts.country ?? 'it',
      });
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
/** Titoli affini da cercare sui portali: uno per settore a rotazione, senza quelli già cercati, al massimo `max`. */
function affineQueries(affine, already, max) {
  const have = new Set(already.map((k) => k.toLowerCase()));
  const out = [];
  for (let round = 0; out.length < max && affine.some((s) => s.jobs[round]); round++) {
    for (const s of affine) {
      const title = s.jobs[round];
      if (title && !have.has(title.toLowerCase()) && out.length < max) {
        out.push(title);
        have.add(title.toLowerCase());
      }
    }
  }
  return out;
}

export function resolveProfile(profile, { onlySources, noBrowser = false } = {}) {
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

  // Settori affini (agenzie, documentazione tecnica, comunicazione scientifica…): i loro titoli si cercano anche
  // sui portali, e le offerte trovate così si segnano come "affini".
  const affine = affineForProfile(profile);
  const targets = profile.targets.map((t, i) => {
    if (t.type !== 'area' && t.type !== 'remote') {
      throw new Error(`Target #${i + 1}: "type" deve essere "area" o "remote"`);
    }
    const placeNames = t.type === 'area' ? unique(t.places ?? [t.place]) : [];
    if (t.type === 'area' && !placeNames.length) throw new Error(`Target #${i + 1}: manca "place" o "places"`);
    const country = (t.country ?? 'it').toLowerCase();
    // In Italia le località vengono geolocalizzate per filtrare le offerte per distanza.
    const places = placeNames.map((name) => {
      const comune = country === 'it' ? findComune(name) : null;
      if (country === 'it' && !comune) throw new Error(`Target #${i + 1}: comune "${name}" non trovato`);
      return comune ?? { name };
    });

    const keywords = unique([...(profile.keywords ?? []), ...(t.keywords ?? [])]);
    const queryKeywords = unique(t.searchKeywords ?? profile.searchKeywords ?? keywords).filter(
      (k) => !k.includes('*'),
    );
    const relatedKeywords = unique([...(profile.relatedKeywords ?? []), ...(t.relatedKeywords ?? [])]);
    if (!keywords.length) throw new Error('Serve almeno una parola chiave ("keywords" o --keywords)');

    let sources;
    if (t.sources) {
      sources = t.sources.map((name) => {
        const s = byName.get(name);
        if (!s) throw new Error(`Fonte sconosciuta "${name}". Disponibili: ${[...byName.keys()].join(', ')}`);
        return s;
      });
    } else {
      // Le fonti "optIn" (es. InfoJobs) si usano solo se richieste esplicitamente.
      const enabled = new Set([...(profile.enableSources ?? []), ...(onlySources ?? [])]);
      sources = all.filter((s) => !s.optIn || enabled.has(s.name));
    }
    sources = sources.filter((s) => s.supports.includes(t.type));
    if (onlySources?.length) sources = sources.filter((s) => onlySources.includes(s.name));
    // Senza browser (es. su GitHub Actions) si saltano le fonti che ne hanno bisogno.
    if (noBrowser) sources = sources.filter((s) => !s.browser);

    return {
      ...t,
      id: t.id ?? (t.type === 'remote' ? 'remote' : placeNames.join('-').toLowerCase()),
      label: t.label ?? (t.type === 'remote' ? 'Full remote' : `${placeNames.join(', ')} (+${t.radiusKm ?? 30} km)`),
      country,
      places,
      radiusKm: t.radiusKm ?? 30,
      unknownLocation: t.unknownLocation ?? profile.unknownLocation ?? 'drop',
      keywords,
      relatedKeywords,
      languages: t.languages ?? profile.languages,
      filters: { ...profile.filters, ...t.filters },
      // Parole inviate ai portali (di solito poche e generiche); tutte le "keywords" servono poi al filtro.
      // Le parole con "*" restano solo nel filtro locale: i portali non capiscono i caratteri jolly.
      // Più i titoli dei settori affini (vedi sotto), poche ricerche in più.
      queryKeywords: unique([...queryKeywords, ...affineQueries(affine, queryKeywords, profile.affine?.queries ?? 4)]),
      affine,
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

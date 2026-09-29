import { candidateText } from './candidate.js';
import { checkPublisherSite, discoverPublishers } from './discover.js';
import { resolveSectors } from './sectors.js';
import { watchPublishers } from './watch.js';

/*
 * Il giro automatico sulle aziende, pensato per la ricerca quotidiana (GitHub Actions o cron):
 *   1. ogni `everyDays` giorni ripete la ricerca di case editrici e aziende affini nella zona del profilo e
 *      aggiunge quelle nuove all'elenco ("da valutare"), visitandone il sito;
 *   2. ogni volta sorveglia tutte le aziende dell'elenco (vedi watch.js).
 *
 * La zona e i settori si possono indicare nel profilo:
 *   "publishers": { "places": ["Padova", "Venezia"], "radiusKm": 40, "sectors": "editoria,affini" }
 * Altrimenti si usano le città dei target "area" del profilo, il loro raggio (al massimo 50 km) e
 * "editoria,affini".
 */

const DAY = 24 * 60 * 60 * 1000;

/** Zona e settori delle ricerche automatiche di aziende per un profilo. */
export function autoConfig(profile, candidate = '') {
  const cfg = profile?.publishers ?? {};
  const areas = (profile?.targets ?? []).filter((t) => t.type === 'area');
  const places = cfg.places ?? [...new Set(areas.flatMap((t) => t.places ?? (t.place ? [t.place] : [])))];
  const radiusKm = cfg.radiusKm ?? Math.min(50, Math.max(30, ...areas.map((t) => t.radiusKm ?? 30)));
  return { places, radiusKm, sectors: resolveSectors(cfg.sectors ?? 'editoria,affini', candidate) };
}

/**
 * @param {{ profile, store, state, now?, everyDays?, maxChecks?, discover?, check?, watch? }} options
 * @returns {Promise<{ discovered: boolean, added: object[], events: object[], checked: number, problems: string[], config }>}
 */
export async function autoPublishers({
  profile,
  store,
  state,
  now = new Date(),
  everyDays = 7,
  maxChecks = 30,
  discover = discoverPublishers,
  check = checkPublisherSite,
  watch = watchPublishers,
}) {
  const { text } = await candidateText(profile);
  const config = autoConfig(profile, text);
  const problems = [];
  let added = [];
  const due = !state.lastDiscovery || now - new Date(state.lastDiscovery) >= everyDays * DAY;
  if (due && config.places.length) {
    const found = await discover({ places: config.places, radiusKm: config.radiusKm, sectors: config.sectors });
    problems.push(...found.problems);
    added = found.results.map((r) => store.add(r, now.toISOString())).filter(Boolean);
    // Si visitano i siti delle nuove (non tutte in una volta, per non pesare sui siti).
    for (const p of added.filter((a) => a.website).slice(0, maxChecks)) {
      store.enrich(p.id, await check(p), now.toISOString());
    }
    state.lastDiscovery = now.toISOString();
  } else if (due) {
    problems.push('Nessuna città per cercare le aziende: aggiungi "publishers": { "places": [...] } al profilo.');
  }
  const watched = await watch(store, state, { profile, now: now.toISOString() });
  return {
    discovered: due,
    added,
    events: watched.events,
    checked: watched.checked,
    problems: [...problems, ...watched.problems],
    config,
  };
}

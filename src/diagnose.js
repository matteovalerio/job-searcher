import { buildMatcher, evaluate, REJECT } from './filter.js';
import { checkDistance } from './geo.js';
import { fetchPosting, linkedinJobId, linkedinLocations, searchPages } from './sources/linkedin.js';
import { findKeywords, normalize } from './text.js';

/*
 * "Perché non trovo questa offerta?": dato il link di un'offerta di LinkedIn, per ogni zona (target) del profilo
 *   1. la passa al filtro, spiegando cosa la scarta (parole, esclusioni, località, esperienza…);
 *   2. controlla se le ricerche che il programma fa su LinkedIn la trovano, e a che pagina;
 *   3. se nessuna la trova, cerca il suo titolo nella stessa località: così si capisce se mancano parole da
 *      cercare o se il problema è la località.
 * Alla fine dà consigli concreti su cosa cambiare nel profilo.
 */

/** Titolo pulito da cercare: senza "(m/f)", generi, sigle tra parentesi. */
export function titleQuery(title) {
  return String(title ?? '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b[mfd]\s*\/\s*[mfd](\s*\/\s*[mfd])?\b/gi, ' ')
    .replace(/[|–—-].*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5)
    .join(' ');
}

/** Il verdetto del filtro, con i dettagli utili a capirlo. */
function filterVerdict(job, target, now) {
  const matcher = buildMatcher(target);
  const verdict = evaluate(job, matcher, now);
  const title = normalize(job.title);
  const details = {
    keywordsInTitle: findKeywords(title, matcher.keywords),
    relatedInTitle: findKeywords(title, matcher.related),
    excluded: findKeywords(title, matcher.exclude),
  };
  if (target.type === 'area' && matcher.places)
    details.place = checkDistance(job.location, matcher.places, target.radiusKm);
  return { ...verdict, details };
}

/** Consigli su cosa cambiare nel profilo, a partire dai risultati. */
function advise(job, result) {
  const out = [];
  const { verdict, search } = result;
  const words = titleQuery(job.title);
  switch (verdict.rejected) {
    case REJECT.noKeyword:
      out.push(
        `Né il titolo «${job.title}» né il testo dell'annuncio contengono una parola chiave del profilo: aggiungi a "keywords" (o "relatedKeywords") una parola che descrive il ruolo, per esempio «${words.split(' ')[0].toLowerCase()}».`,
      );
      break;
    case REJECT.excluded:
      out.push(
        `Il titolo contiene una parola esclusa: «${verdict.details.excluded.join('», «')}». Se va bene, toglila da "excludeKeywords".`,
      );
      break;
    case REJECT.farAway:
    case REJECT.unknownPlace:
      out.push(
        `La località «${job.location || 'non indicata'}» ${verdict.rejected === REJECT.farAway ? `risulta fuori dal raggio${verdict.details.place?.distanceKm ? ` (${verdict.details.place.distanceKm} km)` : ''}` : 'non è riconosciuta'}: allarga "radiusKm" o aggiungi il luogo in "places".`,
      );
      break;
    case REJECT.tooOld:
      out.push('È più vecchia del limite del profilo ("maxAgeDays").');
      break;
    case REJECT.notRemote:
    case REJECT.region:
      out.push('Per la zona "remoto" non risulta full remote in Italia o in Europa.');
      break;
    case undefined:
      break;
    default:
      out.push(`Il filtro la scarta: ${verdict.rejected}. Controlla la sezione "filters" del profilo.`);
  }
  if (verdict.fromText) {
    out.push(
      `Il titolo non ha parole chiave, ma il testo sì (${verdict.matched.join(', ')}): la tiene con pochi punti e l'etichetta «trovata nel testo». Nella ricerca normale il testo si legge per le ${result.maxEnrichText} offerte più recenti di questo tipo ("maxEnrichText" nella zona); per darle più peso aggiungi a "relatedKeywords" una parola del titolo, per esempio «${words.toLowerCase()}».`,
    );
  }
  if (search && !search.found) {
    if (search.byTitle?.found) {
      out.push(
        `Nessuna delle ricerche del profilo la trova, ma cercando «${search.byTitle.keyword}» sì: aggiungi a "searchKeywords" una parola del titolo, per esempio «${words.toLowerCase()}».`,
      );
    } else if (search.byTitle) {
      out.push(
        `Non la trova nemmeno cercando il suo titolo a «${search.byTitle.location}»: LinkedIn non la collega a questa località (l'offerta è a «${job.location || 'luogo non indicato'}»). Prova ad aggiungere in "places" la città dell'offerta, o un raggio più ampio.`,
      );
    }
  }
  return out;
}

/**
 * Diagnosi di un'offerta di LinkedIn per un profilo già risolto (resolveProfile).
 * @param {string} ref  link o id dell'offerta
 * @param {{ targets }} profile
 * @param {{ get?, pause?, maxPages?, now? }} options  get: per scaricare le pagine (nei test si inietta)
 */
export async function diagnoseLinkedin(ref, profile, { get, pause = 1500, maxPages = 3, now = Date.now() } = {}) {
  const id = linkedinJobId(ref);
  const job = await fetchPosting(ref, get ? { get } : undefined);
  const same = (j) => j.id.split(':').pop() === id;
  const targets = [];
  for (const target of profile.targets) {
    const result = {
      target: { id: target.id, label: target.label, type: target.type },
      matchIn: target.matchIn,
      maxEnrichText: target.maxEnrichText ?? 30,
    };
    result.verdict = filterVerdict(job, target, now);
    const linkedin = target.sources?.some((s) => s.name === 'linkedin');
    if (!linkedin) {
      result.search = { skipped: 'LinkedIn non è tra le fonti di questa zona' };
    } else if (target.type === 'remote' && [REJECT.notRemote, REJECT.region].includes(result.verdict.rejected)) {
      // Non è un'offerta da remoto: inutile provare le ricerche di questa zona (sarebbero decine).
      result.search = { skipped: 'non è da remoto: conta la ricerca per zona' };
    } else {
      const variants =
        target.type === 'area' ? target.places.map((p) => ({ ...target, place: p.name, placeInfo: p })) : [target];
      const tried = [];
      let found = null;
      outer: for (const variant of variants) {
        for (const location of linkedinLocations(variant)) {
          for (const keyword of target.queryKeywords) {
            const pages = await searchPages({
              keyword,
              location,
              target: variant,
              maxAgeDays: target.maxAgeDays,
              maxPages,
              pause,
              ...(get ? { get } : {}),
            });
            const count = pages.flat().length;
            const page = pages.findIndex((list) => list.some(same));
            tried.push({ keyword, location, count });
            if (page >= 0) {
              const position = pages[page].findIndex(same) + 1;
              found = { keyword, location, page: page + 1, position };
              break outer;
            }
          }
        }
      }
      result.search = { found, tried, pagesChecked: maxPages, normalPages: target.maxPages ?? 2 };
      if (found && found.page > (target.maxPages ?? 2)) result.search.beyondNormalPages = true;
      if (!found) {
        const keyword = titleQuery(job.title);
        const location = linkedinLocations(variants[0])[0];
        const pages = await searchPages({
          keyword,
          location,
          target: variants[0],
          maxAgeDays: target.maxAgeDays,
          maxPages: 1,
          pause,
          ...(get ? { get } : {}),
        });
        result.search.byTitle = { keyword, location, found: pages.flat().some(same) };
      }
    }
    result.advice = advise(job, result);
    if (result.search?.beyondNormalPages) {
      result.advice.push(
        `La ricerca «${result.search.found.keyword}» la trova solo a pagina ${result.search.found.page}, oltre le ${result.search.normalPages} pagine lette di solito: aumenta "maxPages" nella zona o aggiungi una parola di ricerca più precisa.`,
      );
    }
    targets.push(result);
  }
  return { job, targets };
}

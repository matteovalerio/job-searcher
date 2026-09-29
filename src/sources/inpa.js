import { request } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';
import { expectList } from './shape.js';

/*
 * inPA (inpa.gov.it): il portale dove per legge vengono pubblicati concorsi e avvisi di tutta la pubblica
 * amministrazione (ministeri, comuni, università, biblioteche, musei…). Si usa l'interfaccia della pagina
 * "Bandi e avvisi" del sito; se cambia indirizzo si può aggiornare con INPA_API_URL.
 */

const DEFAULT_API = 'https://portale.inpa.gov.it/concorsi-smart/api/concorso-public-area/search-better';
const DETAIL = 'https://www.inpa.gov.it/bandi-e-avvisi/dettaglio-bando-avviso/?concorso_id=';

/** Primo valore testuale non vuoto tra i campi indicati (anche dentro liste e oggetti con "denominazione"/"nome"). */
function pick(obj, ...keys) {
  for (const key of keys) {
    const values = [obj?.[key]].flat().filter(Boolean);
    const text = values
      .map((v) =>
        typeof v === 'string' ? v : (v.denominazione ?? v.nome ?? v.name ?? v.descrizione ?? v.comune?.denominazione),
      )
      .filter((v) => typeof v === 'string' && v.trim())
      .join(', ');
    if (text) return text;
  }
  return '';
}

export function parse(data) {
  const items = data?.content ?? data?.items ?? (Array.isArray(data) ? data : []);
  return items
    .filter((c) => c && (c.titolo || c.title))
    .map((c) => {
      const deadline = pick(c, 'dataScadenza', 'scadenza');
      return makeJob('inpa', {
        id: c.id ?? c.codice,
        title: c.titolo ?? c.title,
        company: pick(c, 'entiRiferimento', 'enteRiferimento', 'ente', 'amministrazione'),
        // La sede di lavoro, altrimenti l'ente ("Comune di Padova") o la regione.
        location:
          pick(c, 'sedi', 'sede', 'comuni', 'luoghi') ||
          pick(c, 'entiRiferimento', 'enteRiferimento', 'ente') ||
          pick(c, 'regioni', 'regione'),
        url: `${DETAIL}${encodeURIComponent(c.id ?? c.codice)}`,
        postedAt: c.dataPubblicazione ?? c.dataInizio,
        description: pick(c, 'descrizioneBreve', 'descrizione', 'abstract'),
        tags: ['concorso pubblico', deadline ? `scade il ${deadline.slice(0, 10)}` : ''],
      });
    });
}

export default {
  name: 'inpa',
  label: 'inPA (concorsi pubblici)',
  supports: ['area'],
  async search({ keywords, warn }) {
    const api = process.env.INPA_API_URL || DEFAULT_API;
    return eachQuery(
      keywords,
      async (keyword) => {
        const res = await request(`${api}?page=0&size=50`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ text: keyword, status: ['OPEN'] }),
        });
        return parse(expectList(await res.json(), ['content', 'items', '']));
      },
      warn,
    );
  },
};

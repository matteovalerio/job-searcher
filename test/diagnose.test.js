import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { diagnoseLinkedin, titleQuery } from '../src/diagnose.js';
import { checkDistance, findComune } from '../src/geo.js';
import { linkedinJobId, parsePosting } from '../src/sources/linkedin.js';

const posting = () => readFile(new URL('./fixtures/linkedin-posting.html', import.meta.url), 'utf8');

/** Pagina di risultati di LinkedIn con le offerte indicate. */
const results = (jobs) =>
  jobs
    .map(
      ({
        id,
        title,
        location = 'Padova, Veneto, Italia',
      }) => `<li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
  <a class="base-card__full-link" href="https://it.linkedin.com/jobs/view/x-${id}?refId=1"></a>
  <h3 class="base-search-card__title">${title}</h3><h4 class="base-search-card__subtitle"><a>Azienda</a></h4>
  <span class="job-search-card__location">${location}</span><time datetime="2026-09-20"></time></div></li>`,
    )
    .join('\n');

test('id delle offerte di LinkedIn dai vari tipi di link', () => {
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/view/4470018594/'), '4470018594');
  assert.equal(
    linkedinJobId('https://it.linkedin.com/jobs/view/redattore-at-edizioni-x-4438330828?refId=abc'),
    '4438330828',
  );
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/search/?currentJobId=4469744510&geoId=1'), '4469744510');
  assert.equal(linkedinJobId('4469744510'), '4469744510');
  assert.equal(linkedinJobId('https://example.com'), null);
});

test("pagina di un'offerta: titolo, azienda, località, data approssimata, descrizione", async () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const job = parsePosting(await posting(), '4470018594', now);
  assert.equal(job.title, 'Addetta/o Ufficio Editoriale (m/f)');
  assert.equal(job.company, 'Edizioni del Brenta');
  assert.equal(job.location, 'Padua, Veneto, Italy');
  assert.equal(job.postedAt.slice(0, 10), '2026-09-15');
  assert.match(job.description, /Revisione dei testi/);
  assert.deepEqual(job.tags, ['A tempo pieno']);
  assert.equal(titleQuery(job.title), 'Addetta/o Ufficio Editoriale');
});

test('località in inglese di LinkedIn ("Padua", "Venice", "Lombardy") riconosciute', () => {
  const places = [findComune('Piazzola sul Brenta')];
  assert.equal(checkDistance('Padua, Veneto, Italy', places, 30).ok, true);
  assert.equal(checkDistance('Greater Padua Metropolitan Area', places, 30).ok, true);
  assert.equal(checkDistance('Milan, Lombardy, Italy', places, 30).reason, 'fuori zona');
  assert.equal(checkDistance('Venice, Veneto, Italy', places, 50).ok, true);
});

const profile = () =>
  resolveProfile({
    name: 'Prova',
    keywords: ['redattore', 'editorial*'],
    excludeKeywords: ['stage'],
    matchIn: 'title',
    affine: { sectors: 'no' },
    targets: [
      {
        id: 'zona',
        label: 'Piazzola',
        type: 'area',
        places: ['Piazzola sul Brenta'],
        radiusKm: 30,
        searchKeywords: ['redattore', 'editor'],
        sources: ['linkedin'],
      },
    ],
  });

test('diagnosi: il filtro la tiene, ma le ricerche del profilo non la trovano; con il titolo sì', async () => {
  const html = await posting();
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    if (url.includes('/jobPosting/')) return html;
    const keywords = new URL(url).searchParams.get('keywords');
    // Solo cercando il titolo LinkedIn restituisce l'offerta.
    if (keywords === 'Addetta/o Ufficio Editoriale')
      return results([{ id: '4470018594', title: 'Addetta/o Ufficio Editoriale' }]);
    return results([{ id: '1', title: 'Redattore' }]);
  };
  const { job, targets } = await diagnoseLinkedin('https://www.linkedin.com/jobs/view/4470018594/', profile(), {
    get,
    pause: 0,
    now: Date.parse('2026-09-29T12:00:00Z'),
  });
  assert.equal(job.title, 'Addetta/o Ufficio Editoriale (m/f)');
  const [zone] = targets;
  assert.equal(zone.verdict.rejected, undefined, 'il filtro la tiene: "editoriale" è tra le parole chiave');
  assert.equal(zone.verdict.details.place.ok, true);
  assert.equal(zone.search.found, null);
  assert.deepEqual(
    zone.search.tried.map((t) => t.keyword),
    ['redattore', 'editor'],
  );
  assert.equal(zone.search.byTitle.found, true);
  assert.match(zone.advice.join('\n'), /aggiungi a "searchKeywords".*addetta\/o ufficio editoriale/);
  // Le ricerche usano la località del profilo con il raggio in miglia.
  const search = new URL(urls.find((u) => u.includes('seeMoreJobPostings')));
  assert.equal(search.searchParams.get('location'), 'Piazzola sul Brenta, Veneto, Italia');
  assert.equal(search.searchParams.get('distance'), '25');
});

test('diagnosi: trovata dalle ricerche ma scartata dal filtro per una parola esclusa', async () => {
  const html = (await posting()).replace('Addetta/o Ufficio Editoriale (m/f)', 'Stage Redattore');
  const get = async (url) =>
    url.includes('/jobPosting/')
      ? html
      : results([
          { id: '9', title: 'Altro' },
          { id: '4470018594', title: 'Stage Redattore' },
        ]);
  const { targets } = await diagnoseLinkedin('4470018594', profile(), { get, pause: 0 });
  const [zone] = targets;
  assert.equal(zone.verdict.rejected, 'parola esclusa nel titolo');
  assert.deepEqual(zone.search.found, {
    keyword: 'redattore',
    location: 'Piazzola sul Brenta, Veneto, Italia',
    page: 1,
    position: 2,
  });
  assert.match(zone.advice[0], /parola esclusa: «stage»/);
});

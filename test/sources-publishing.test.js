import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { buildMatcher, evaluate } from '../src/filter.js';
import {
  createWorkdaySource,
  parseGreenhouse,
  parseLever,
  parseSmartRecruiters,
  parseWorkday,
  workdayApi,
  workdayDate,
} from '../src/sources/ats.js';
import { createCareersSource, discoverCareersPage, findCareersLink, parseCareersPage } from '../src/sources/careers.js';
import { parse as parseInpa } from '../src/sources/inpa.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/careers/${name}`, import.meta.url), 'utf8');

test('careers: trova "Lavora con noi" nella home e legge le offerte', () => {
  assert.equal(
    findCareersLink(fixture('home.html'), 'https://www.esempio.it/'),
    'https://www.esempio.it/chi-siamo/lavora-con-noi',
  );
  assert.equal(findCareersLink('<a href="/catalogo">Catalogo</a>', 'https://x.it'), null);

  const items = parseCareersPage(fixture('lavora-con-noi.html'), 'https://www.esempio.it/chi-siamo/lavora-con-noi');
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Redattrice/Redattore scientifico'));
  assert.ok(titles.includes('Correttore di bozze (collaborazione)'));
  assert.ok(!titles.includes('Home') && !titles.includes('Privacy'), 'menu e piè di pagina esclusi');
  assert.ok(!titles.some((t) => t.includes('lavoro@esempio.it')), 'niente link email');
  assert.equal(
    items.find((i) => i.title.startsWith('Redattrice')).url,
    'https://www.esempio.it/lavora-con-noi/redattrice-scientifica',
  );
});

test('careers: dati strutturati JSON-LD se ci sono', () => {
  const html = `<script type="application/ld+json">{"@type":["JobPosting"],"title":"Editor","url":"/job/1","hiringOrganization":{"name":"Esempio"},"jobLocation":{"address":{"addressLocality":"Vicenza"}}}</script><h2>Altro</h2>`;
  assert.deepEqual(
    parseCareersPage(html, 'https://x.it/careers').map((i) => [i.title, i.location, i.url]),
    [['Editor', 'Vicenza', 'https://x.it/job/1']],
  );
});

test('careers: una pagina per esecuzione, località e azienda dalla configurazione, errori per pagina', async (t) => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetched.push(String(url));
    if (String(url).includes('rotto.it')) return new Response('', { status: 404 });
    return new Response(fixture(String(url).includes('lavora-con-noi') ? 'lavora-con-noi.html' : 'home.html'));
  });
  const source = createCareersSource({
    name: 'editori',
    pages: [
      { company: 'Edizioni Esempio', url: 'https://www.esempio.it', location: 'Padova' },
      { company: 'Rotto', url: 'https://www.rotto.it/lavora-con-noi', location: 'Vicenza' },
    ],
  });
  const warnings = [];
  const jobs = await source.search({ keywords: ['redattore'], target: {}, warn: (w) => warnings.push(w) });
  await source.search({ keywords: ['redattore'], target: {}, warn: () => {} });
  assert.equal(fetched.filter((u) => u.includes('esempio.it')).length, 2, 'home + pagina offerte, una volta sola');
  const redattrice = jobs.find((j) => j.title.startsWith('Redattrice'));
  assert.equal(redattrice.company, 'Edizioni Esempio');
  assert.equal(redattrice.location, 'Padova');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 404/);

  // Il filtro del profilo tiene solo le offerte pertinenti
  const m = buildMatcher({
    type: 'area',
    keywords: ['redattore', 'redattrice', 'correttore di bozze'],
    excludeKeywords: [],
    boostKeywords: [],
    matchIn: 'title',
  });
  assert.deepEqual(
    jobs.filter((j) => !evaluate(j, m).rejected).map((j) => j.title),
    ['Redattrice/Redattore scientifico', 'Correttore di bozze (collaborazione)'],
  );
});

test("workday: indirizzo dell'interfaccia, date relative e offerte", async (t) => {
  assert.deepEqual(workdayApi('https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers'), {
    api: 'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/jobs',
    base: 'https://acme.wd3.myworkdayjobs.com/AcmeCareers',
  });
  assert.throws(() => workdayApi('https://acme.wd3.myworkdayjobs.com/'), /incompleto/);
  const now = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(workdayDate('Posted Today', now), '2026-09-28T12:00:00.000Z');
  assert.equal(workdayDate('Posted 3 Days Ago', now), '2026-09-25T12:00:00.000Z');
  assert.equal(workdayDate('Posted 30+ Days Ago', now), '2026-08-29T12:00:00.000Z');
  assert.equal(workdayDate('', now), null);

  const data = {
    total: 2,
    jobPostings: [
      {
        title: 'Associate Editor',
        externalPath: '/job/Milan/Associate-Editor_R1',
        locationsText: 'Milan, Italy',
        postedOn: 'Posted Today',
      },
      {
        title: 'Copy Editor',
        externalPath: '/job/Remote/Copy-Editor_R2',
        locationsText: 'Remote - Europe',
        postedOn: 'Posted Yesterday',
      },
    ],
  };
  const [milan, remote] = parseWorkday(data, {
    base: 'https://acme.wd3.myworkdayjobs.com/Acme',
    employer: 'Acme',
    source: 'acme',
  });
  assert.equal(milan.url, 'https://acme.wd3.myworkdayjobs.com/Acme/job/Milan/Associate-Editor_R1');
  assert.equal(milan.source, 'acme');
  assert.equal(milan.remote, null);
  assert.equal(remote.remote, true);

  let body;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    body = JSON.parse(init.body);
    return Response.json(data);
  });
  const source = createWorkdaySource({
    name: 'acme',
    url: 'https://acme.wd3.myworkdayjobs.com/Acme',
    employer: 'Acme',
  });
  assert.equal((await source.search({ keywords: ['editor'] })).length, 2);
  assert.equal(body.searchText, 'editor');
});

test('greenhouse, lever, smartrecruiters', () => {
  const [gh] = parseGreenhouse(
    {
      jobs: [
        {
          id: 1,
          title: 'Managing Editor',
          absolute_url: 'https://boards.greenhouse.io/x/jobs/1',
          location: { name: 'Remote, EMEA' },
          updated_at: '2026-09-20T00:00:00Z',
          content: '&lt;p&gt;Journals&lt;/p&gt;',
        },
      ],
    },
    { employer: 'X', source: 'x' },
  );
  assert.deepEqual(
    [gh.title, gh.location, gh.remote, gh.description],
    ['Managing Editor', 'Remote, EMEA', true, 'Journals'],
  );

  const [lv] = parseLever(
    [
      {
        id: 'a',
        text: 'Editorial Assistant',
        hostedUrl: 'https://jobs.lever.co/y/a',
        categories: { location: 'Berlin', commitment: 'Full-time' },
        createdAt: 1790000000000,
        workplaceType: 'remote',
      },
    ],
    { employer: 'Y' },
  );
  assert.deepEqual([lv.title, lv.remote, lv.url], ['Editorial Assistant', true, 'https://jobs.lever.co/y/a']);

  const [sr] = parseSmartRecruiters(
    {
      content: [
        {
          id: '123',
          name: 'Redattore',
          company: { name: 'Z Spa' },
          location: { city: 'Padova', country: 'it', remote: false },
          releasedDate: '2026-09-21T00:00:00Z',
        },
      ],
    },
    { company: 'ZSpa', employer: 'Z' },
  );
  assert.deepEqual(
    [sr.company, sr.location, sr.url, sr.remote],
    ['Z Spa', 'Padova, IT', 'https://jobs.smartrecruiters.com/ZSpa/123', null],
  );
});

test('inpa: bandi con ente, sede e scadenza', () => {
  const jobs = parseInpa({
    content: [
      {
        id: 'abc-1',
        titolo: 'Concorso per 1 posto di redattore - ufficio pubblicazioni',
        entiRiferimento: ['Università degli Studi di Padova'],
        sedi: [{ comune: { denominazione: 'Padova' } }],
        dataPubblicazione: '2026-09-20T10:00:00',
        dataScadenza: '2026-10-20T12:00:00',
        descrizioneBreve: 'Redazione delle pubblicazioni di ateneo',
      },
      { id: 'abc-2', titolo: 'Istruttore culturale', entiRiferimento: ['Comune di Vicenza'] },
    ],
  });
  assert.equal(jobs[0].company, 'Università degli Studi di Padova');
  assert.equal(jobs[0].location, 'Padova');
  assert.equal(jobs[0].url, 'https://www.inpa.gov.it/bandi-e-avvisi/dettaglio-bando-avviso/?concorso_id=abc-1');
  assert.deepEqual(jobs[0].tags, ['concorso pubblico', 'scade il 2026-10-20']);
  assert.equal(jobs[1].location, 'Comune di Vicenza', "senza sede si usa l'ente");
  assert.deepEqual(parseInpa({}), []);
});

test('le nuove fonti si configurano nel profilo', () => {
  const profile = resolveProfile({
    keywords: ['editor'],
    targets: [{ type: 'area', place: 'Padova' }],
    customSources: [
      { type: 'careers', name: 'editori', pages: [{ company: 'A', url: 'https://a.it' }] },
      { type: 'workday', name: 'acme', url: 'https://acme.wd3.myworkdayjobs.com/Acme' },
      { type: 'greenhouse', name: 'gh', board: 'x' },
      { type: 'lever', name: 'lv', company: 'y', region: 'eu' },
      { type: 'smartrecruiters', name: 'sr', company: 'Z' },
    ],
  });
  const names = profile.targets[0].sources.map((s) => s.name);
  for (const n of ['inpa', 'editori', 'acme', 'gh', 'lv', 'sr']) assert.ok(names.includes(n), n);
  assert.throws(
    () =>
      resolveProfile({ keywords: ['x'], targets: [{ type: 'remote' }], customSources: [{ type: 'boh', name: 'b' }] }),
    /tipi disponibili/,
  );
  assert.throws(
    () =>
      resolveProfile({
        keywords: ['x'],
        targets: [{ type: 'remote' }],
        customSources: [{ type: 'careers', name: 'c' }],
      }),
    /almeno una pagina/,
  );
});

test('careers: sceglie il link più affidabile', () => {
  const html = `<a href="/opportunita-di-lavoro">Opportunità di lavoro</a> <a href="https://esterno.it/jobs">Jobs</a>
    <a href="/chi-siamo/lavora-con-noi">Lavora con noi</a> <a href="/autori">Opportunità per gli autori</a>`;
  assert.equal(findCareersLink(html, 'https://editore.it/'), 'https://editore.it/chi-siamo/lavora-con-noi');
  assert.equal(findCareersLink('<a href="/proposte">Invia un manoscritto</a>', 'https://editore.it/'), null);
});

test('careers: se la home non ha il link, prova la mappa del sito e poi gli indirizzi comuni', async () => {
  const site = (pages) => async (url) => {
    if (url in pages) return pages[url];
    throw new Error(`HTTP 404 su ${url}`);
  };
  const viaSitemap = await discoverCareersPage(
    { company: 'A', url: 'https://a.it' },
    site({
      'https://a.it': '<a href="/catalogo">Catalogo</a>',
      'https://a.it/robots.txt': 'User-agent: *\nSitemap: https://a.it/wp-sitemap.xml',
      'https://a.it/wp-sitemap.xml':
        '<sitemapindex><sitemap><loc>https://a.it/wp-sitemap-posts-post-1.xml</loc></sitemap><sitemap><loc>https://a.it/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>',
      'https://a.it/wp-sitemap-posts-page-1.xml':
        '<urlset><url><loc>https://a.it/contatti/</loc></url><url><loc>https://a.it/chi-siamo/lavora-con-noi/</loc></url></urlset>',
      'https://a.it/chi-siamo/lavora-con-noi/': '<h2>Redattore</h2>',
    }),
  );
  assert.deepEqual([viaSitemap.url, viaSitemap.via], ['https://a.it/chi-siamo/lavora-con-noi/', 'mappa del sito']);

  const viaPath = await discoverCareersPage(
    { company: 'B', url: 'https://b.it' },
    site({ 'https://b.it': '<p>Benvenuti</p>', 'https://b.it/careers': '<h1>Careers</h1><h2>Editor</h2>' }),
  );
  assert.deepEqual([viaPath.url, viaPath.via], ['https://b.it/careers', 'indirizzo comune']);

  const direct = await discoverCareersPage(
    { company: 'C', url: 'https://c.it/pagina/42', direct: true },
    site({ 'https://c.it/pagina/42': 'x' }),
  );
  assert.equal(direct.via, 'indirizzo indicato');

  await assert.rejects(
    discoverCareersPage({ company: 'D', url: 'https://d.it' }, site({ 'https://d.it': '<p>niente</p>' })),
    /D: nessuna pagina "lavora con noi" trovata.*"direct": true/,
  );
});

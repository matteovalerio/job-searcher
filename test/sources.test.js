import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import adzuna, { parse as parseAdzuna } from '../src/sources/adzuna.js';
import { parse as parseHimalayas } from '../src/sources/himalayas.js';
import { parseHtml } from '../src/sources/html.js';
import { parse as parseJobicy } from '../src/sources/jobicy.js';
import { parse as parseJooble } from '../src/sources/jooble.js';
import linkedin, { kmToLinkedinMiles, parse as parseLinkedin } from '../src/sources/linkedin.js';
import { eachQuery } from '../src/sources/queries.js';
import { parse as parseRemoteok } from '../src/sources/remoteok.js';
import { parse as parseRemotive } from '../src/sources/remotive.js';
import { parseFeed } from '../src/sources/rss.js';
import wwr, { splitTitle } from '../src/sources/weworkremotely.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));

test('linkedin: estrae le card e pulisce gli URL', () => {
  const jobs = parseLinkedin(fixture('linkedin.html'));
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    { id: jobs[0].id, title: jobs[0].title, company: jobs[0].company, location: jobs[0].location, url: jobs[0].url },
    {
      id: 'linkedin:4012345678',
      title: 'Redattore/Redattrice',
      company: 'Edizioni Esempio S.r.l.',
      location: 'Padova, Veneto, Italia',
      url: 'https://it.linkedin.com/jobs/view/redattore-4012345678',
    },
  );
  assert.equal(jobs[0].postedAt, '2026-09-20T00:00:00.000Z');
  assert.equal(jobs[0].remote, null);
  assert.equal(parseLinkedin(fixture('linkedin.html'), { remote: true })[0].remote, true);
});

test('linkedin: converte km nei raggi ammessi', () => {
  assert.equal(kmToLinkedinMiles(10), 10);
  assert.equal(kmToLinkedinMiles(40), 25);
  assert.equal(kmToLinkedinMiles(60), 50);
  assert.equal(kmToLinkedinMiles(500), 100);
});

test('remotive', () => {
  const [job] = parseRemotive(json('remotive.json'));
  assert.equal(job.title, 'Copy Editor (Books)');
  assert.equal(job.company, 'Great Books Publishing');
  assert.equal(job.location, 'Europe');
  assert.equal(job.remote, true);
  assert.match(job.description, /publisher of books/);
});

test("remoteok: salta l'avviso legale iniziale", () => {
  const jobs = parseRemoteok(json('remoteok.json'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Proofreader');
  assert.equal(jobs[0].salary, '30000-40000 USD');
});

test('jobicy: decodifica le entità HTML', () => {
  const [job] = parseJobicy(json('jobicy.json'));
  assert.equal(job.company, 'Paper & Ink');
  assert.equal(job.location, 'Anywhere');
});

test('himalayas: senza restrizioni geografiche = Worldwide', () => {
  const [open, canada] = parseHimalayas(json('himalayas.json'));
  assert.equal(open.location, 'Worldwide');
  assert.equal(canada.location, 'Canada');
  assert.equal(open.postedAt, new Date(1790100000 * 1000).toISOString());
});

test('adzuna e jooble', () => {
  const [a] = parseAdzuna(json('adzuna.json'));
  assert.equal(a.title, 'Redattrice editoriale');
  assert.equal(a.company, 'Scuola Libri SpA');
  const [j] = parseJooble(json('jooble.json'));
  assert.equal(j.location, 'Abano Terme');
  assert.match(j.description, /redattore per casa editrice/);
});

test('rss: legge RSS 2.0 e Atom', () => {
  const [item] = parseFeed(fixture('weworkremotely.rss'));
  assert.equal(item.title, 'Inkwell Press: Senior Copy Editor');
  assert.equal(item.location, 'Anywhere in the World');
  const [entry] = parseFeed(fixture('atom.xml'));
  assert.equal(entry.link, 'https://example.org/annuncio/1');
  assert.equal(entry.date, '2026-09-23T07:00:00Z');
});

test('weworkremotely: separa azienda e titolo', async (t) => {
  assert.deepEqual(splitTitle('Acme: Editor: Books'), { company: 'Acme', title: 'Editor: Books' });
  t.mock.method(globalThis, 'fetch', async () => new Response(fixture('weworkremotely.rss')));
  const [job] = await wwr.search({ keywords: ['editor'], target: { type: 'remote' } });
  assert.equal(job.title, 'Senior Copy Editor');
  assert.equal(job.company, 'Inkwell Press');
  assert.equal(job.remote, true);
});

test('html: selettori CSS e URL relativi', () => {
  const items = parseHtml(fixture('careers.html'), {
    baseUrl: 'https://editore.example/lavora-con-noi',
    selectors: { item: 'li.opening', title: '.title', link: '.title@href', location: '.where', date: 'time@datetime' },
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://editore.example/lavora-con-noi/redattore');
  assert.equal(items[0].postedAt, '2026-09-10');
  assert.equal(items[1].url, 'https://altro.example/magazziniere');
});

test('eachQuery: tiene i risultati parziali e fallisce solo se falliscono tutte', async () => {
  const warnings = [];
  const jobs = await eachQuery(
    ['a', 'b'],
    async (q) => {
      if (q === 'b') throw new Error('HTTP 429');
      return [q];
    },
    (w) => warnings.push(w),
  );
  assert.deepEqual(jobs, ['a']);
  assert.equal(warnings.length, 1);
  await assert.rejects(
    eachQuery(['a'], async () => {
      throw new Error('giù');
    }),
    /giù/,
  );
});

test('linkedin: località completa per le aree e geoId per il remoto', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(new URL(url));
    return new Response('');
  });
  const padova = { name: 'Padova', region: 'Veneto' };
  await linkedin.search({ keywords: ['redattore'], target: { type: 'area', place: 'Padova', placeInfo: padova } });
  await linkedin.search({
    keywords: ['editor'],
    target: { type: 'remote', linkedinLocations: ['Italia', 'Worldwide'] },
  });
  const params = urls.map((u) => Object.fromEntries(u.searchParams));
  assert.equal(params[0].location, 'Padova, Veneto, Italia');
  assert.equal(params[0].f_WT, undefined);
  assert.deepEqual(
    params.slice(1).map((p) => [p.location, p.geoId, p.f_WT]),
    [
      ['Italia', '103350119', '2'],
      ['Worldwide', '92000000', '2'],
    ],
  );
});

test('adzuna: cerca solo nel titolo con matchIn "title"; per il remoto niente località', async (t) => {
  process.env.ADZUNA_APP_ID ??= 'id';
  process.env.ADZUNA_APP_KEY ??= 'key';
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(new URL(url));
    return Response.json({ results: [] });
  });
  await adzuna.search({
    keywords: ['redattore'],
    target: { type: 'area', place: 'Vicenza', radiusKm: 35, matchIn: 'title' },
  });
  await adzuna.search({ keywords: ['editor'], target: { type: 'remote', matchIn: 'title+description' } });
  const [area, remote] = urls.map((u) => Object.fromEntries(u.searchParams));
  assert.equal(area.title_only, 'redattore');
  assert.equal(area.what_phrase, undefined);
  assert.equal(area.where, 'Vicenza');
  assert.equal(remote.what_phrase, 'editor');
  assert.equal(remote.where, undefined);
  assert.match(remote.what_or, /remoto/);
});

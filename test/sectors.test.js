import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overpassQuery, parseOverpass } from '../src/publishers/discover.js';
import {
  affineSectors,
  familiesFromText,
  kindLabel,
  PUBLISHING_SECTORS,
  resolveSectors,
  SECTORS,
  suggestSectors,
} from '../src/publishers/sectors.js';
import { parseSearchResults, searchQueries } from '../src/publishers/websearch.js';

const REDATTRICE =
  'Redattrice in casa editrice scientifica: revisione di bozze, rapporti con gli autori, peer review, ' +
  'coordinamento di progetti editoriali, impaginazione con InDesign. Laurea magistrale in linguistica.';

test('ogni settore è completo', () => {
  for (const s of SECTORS) {
    assert.ok(s.id && s.label && s.one && s.why, s.id);
    assert.ok(s.roles.length && s.web.length, s.id);
    assert.ok(s.hint instanceof RegExp && typeof s.matches === 'function', s.id);
  }
  assert.equal(new Set(SECTORS.map((s) => s.id)).size, SECTORS.length);
});

test('settori affini ordinati in base al profilo', () => {
  assert.ok(familiesFromText(REDATTRICE).editoria > 0);
  const ranked = suggestSectors(REDATTRICE).map((s) => s.id);
  assert.equal(ranked[0], 'casa-editrice');
  assert.ok(ranked.indexOf('comunicazione-scientifica') < ranked.indexOf('giornali'));
  const affini = affineSectors(REDATTRICE);
  assert.equal(affini.length, 6);
  assert.ok(!affini.some((id) => PUBLISHING_SECTORS.includes(id)));
  assert.ok(affini.includes('comunicazione-scientifica'));
  assert.deepEqual(suggestSectors('Magazziniere con patente'), []);
});

test('scelta dei settori: predefiniti, affini, tutti, elenco', () => {
  assert.deepEqual(resolveSectors(''), PUBLISHING_SECTORS);
  assert.deepEqual(resolveSectors('libreria, tipografia'), ['libreria', 'tipografia']);
  assert.equal(resolveSectors('tutti').length, SECTORS.length);
  assert.deepEqual(resolveSectors('editoria,affini', REDATTRICE).slice(0, 3), PUBLISHING_SECTORS);
  assert.throws(() => resolveSectors('pizzerie'), /Settore sconosciuto "pizzerie"/);
  assert.equal(kindLabel('agenzia-comunicazione'), 'agenzia di comunicazione');
  assert.equal(kindLabel('altro'), 'altro');
});

test('OpenStreetMap per settore: agenzie, tipografie, librerie', () => {
  const center = { name: 'Padova', lat: 45.407, lon: 11.8763 };
  const q = overpassQuery(center, 20, ['agenzia-comunicazione', 'tipografia']);
  assert.match(q, /nwr\["office"="advertising_agency"\]\(around:20000,45.407,11.8763\);/);
  assert.match(q, /nwr\["craft"="printer"\]/);
  assert.doesNotMatch(q, /publisher/);
  const json = {
    elements: [
      { type: 'node', lat: 45.41, lon: 11.87, tags: { name: 'Idea Comunicazione', office: 'advertising_agency' } },
      { type: 'node', lat: 45.42, lon: 11.88, tags: { name: 'Tipografia Veneta', craft: 'printer' } },
      {
        type: 'node',
        lat: 45.47,
        lon: 11.83,
        tags: { name: 'Libreria Universitaria', shop: 'books', website: 'https://www.libreriauniversitaria.it' },
      },
      { type: 'node', lat: 45.41, lon: 11.87, tags: { name: 'Bar Centrale', amenity: 'cafe' } },
    ],
  };
  const all = parseOverpass(json, center, ['agenzia-comunicazione', 'tipografia', 'libreria']);
  assert.deepEqual(
    all.map((r) => [r.name, r.kind]),
    [
      ['Idea Comunicazione', 'agenzia-comunicazione'],
      ['Tipografia Veneta', 'tipografia'],
      ['Libreria Universitaria', 'libreria'],
    ],
  );
});

test('ricerca web per settore: Libreria Universitaria non è più scartata', () => {
  const queries = searchQueries('Padova', ['libreria', 'agenzia-comunicazione']);
  assert.deepEqual(queries[0], { q: 'libreria universitaria Padova', sector: 'libreria' });
  assert.ok(queries.some((q) => q.q === 'agenzia di comunicazione Padova' && q.sector === 'agenzia-comunicazione'));
  const results = [
    {
      title: 'Libreria Universitaria: libri, ebook e testi universitari',
      url: 'https://www.libreriauniversitaria.it/',
      description: 'La libreria online con sede a Limena (Padova): testi universitari e libri.',
    },
    { title: 'Amazon.it: libri', url: 'https://www.amazon.it/libri', description: 'libri' },
  ];
  const found = parseSearchResults(results, 'Padova', 'libreria');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Libreria Universitaria');
  assert.equal(found[0].kind, 'libreria');
  assert.equal(found[0].city, 'Padova');
  const agency = parseSearchResults(
    [
      {
        title: 'Studio Rossi | Grafica e comunicazione',
        url: 'https://studiorossi.it/',
        description: 'Brochure e cataloghi',
      },
    ],
    'Padova',
    'agenzia-comunicazione',
  );
  assert.equal(agency[0].kind, 'agenzia-comunicazione');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildPublishersPrompt, parsePublisherList } from '../src/publishers/import.js';
import { nameFromTitle, parseSearchResults, searchQueries, searchWeb } from '../src/publishers/websearch.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/publishers/${name}`, import.meta.url), 'utf8'));

test('ricerca web: tiene i siti degli editori, uno per dominio, senza elenchi e librerie online', async () => {
  const { web } = await fixture('brave.json');
  const found = parseSearchResults(web.results, 'Venezia');
  assert.deepEqual(
    found.map((f) => f.name),
    ['Wetlands', 'Studio Redazionale Laguna', 'Edizioni Rosse'],
  );
  const [wetlands, studio, rosse] = found;
  assert.equal(wetlands.website, 'https://wetlandsbooks.com/');
  assert.equal(wetlands.city, 'Venezia');
  assert.equal(wetlands.description.includes('<strong>'), false);
  assert.ok(wetlands.specialties.includes('narrativa'));
  assert.equal(studio.kind, 'studio-editoriale');
  assert.equal(rosse.city, null, 'la città si indica solo se la pagina la nomina');
  assert.deepEqual(rosse.specialties.slice(0, 1), ['bambini']);
  assert.equal(nameFromTitle('Home | Sito ufficiale', 'www.esempio.it'), 'Esempio');
});

test('ricerca web: senza chiave non fa nulla; con la chiave cerca ogni frase per ogni città', async () => {
  assert.deepEqual(await searchWeb(['Venezia'], { key: '' }), { results: [], problems: [], skipped: true });
  const urls = [];
  const http = {
    async getJson(url, init) {
      urls.push(url);
      assert.equal(init.headers['X-Subscription-Token'], 'k');
      return fixture('brave.json');
    },
  };
  const { results, problems } = await searchWeb(['Venezia', 'Padova'], { key: 'k', http, pause: 0 });
  assert.equal(urls.length, searchQueries('x').length * 2);
  assert.match(urls[0], /q=casa\+editrice\+Venezia/);
  assert.ok(results.length >= 3);
  assert.deepEqual(problems, []);
  const denied = await searchWeb(['Venezia'], {
    key: 'bad',
    pause: 0,
    http: {
      async getJson() {
        throw new Error('HTTP 401 su https://api.search.brave.com');
      },
    },
  });
  assert.equal(denied.problems.length, 1, 'con la chiave sbagliata si ferma subito');
});

test('elenco da Claude: blocco JSON con array', () => {
  const answer = `Ecco l'elenco:
\`\`\`json
[
  { "name": "Wetlands", "website": "wetlandsbooks.com", "city": "Venezia", "kind": "casa-editrice", "specialties": ["narrativa", "boh"], "note": "narrativa e saggi" },
  { "name": "Studio Laguna", "website": "", "city": "Mestre", "kind": "studio-editoriale" }
]
\`\`\``;
  const list = parsePublisherList(answer);
  assert.equal(list.length, 2);
  assert.equal(list[0].website, 'https://wetlandsbooks.com/');
  assert.deepEqual(list[0].specialties, ['narrativa']);
  assert.equal(list[0].source, 'claude');
  assert.equal(list[1].website, null);
  assert.equal(list[1].kind, 'studio-editoriale');
});

test('elenco semplice: una casa editrice per riga', () => {
  const list = parsePublisherList(`- Wetlands | wetlandsbooks.com | Venezia
2. Edizioni Esempio
https://www.marsilioeditori.it/
Studio Bozze; Padova`);
  assert.deepEqual(
    list.map((p) => [p.name, p.website, p.city]),
    [
      ['Wetlands', 'https://wetlandsbooks.com/', 'Venezia'],
      ['Edizioni Esempio', null, null],
      ['marsilioeditori', 'https://www.marsilioeditori.it/', null],
      ['Studio Bozze', null, 'Padova'],
    ],
  );
  assert.ok(list.every((p) => p.source === 'elenco'));
});

test('prompt per Claude: zona, regole contro le invenzioni, formato e case editrici già note', () => {
  const prompt = buildPublishersPrompt({ places: ['Padova', 'Venezia'], radiusKm: 40, known: ['Marsilio'] });
  assert.match(prompt, /Padova, Venezia o entro circa 40 km/);
  assert.match(prompt, /Niente nomi inventati/);
  assert.match(prompt, /```json/);
  assert.match(prompt, /non ripeterle: Marsilio/);
  assert.match(prompt, /"studio-editoriale"/);
});

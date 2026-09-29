import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { bestContact, extractPeople, findPeople, nameOf, roleOf, teamLinks } from '../src/publishers/people.js';

const fixture = (name) => readFile(new URL(`./fixtures/people/${name}`, import.meta.url), 'utf8');

test('nomi e ruoli riconosciuti; niente persone tra titoli, collane e indirizzi', () => {
  assert.equal(nameOf('Maria Rossi'), 'Maria Rossi');
  assert.equal(nameOf('dott.ssa Anna De Luca'), 'Anna De Luca');
  assert.equal(nameOf('Casa Editrice'), null);
  assert.equal(nameOf('Via Roma'), null);
  assert.equal(nameOf('Chi siamo'), null);
  assert.equal(roleOf('Direttrice editoriale').rank, 1);
  assert.equal(roleOf('Ufficio risorse umane').rank, 0);
  assert.equal(roleOf('Casa editrice'), null, '"editrice" di "casa editrice" non è un ruolo');
  assert.equal(roleOf('Fondatrice ed editrice').rank, 2);
});

test('pagina con le schede del team: nome sopra, ruolo sotto; gli autori senza ruolo non contano', async () => {
  const people = extractPeople(await fixture('chi-siamo.html'));
  assert.deepEqual(
    people.map((p) => [p.name, p.role, p.rank]),
    [
      ['Anna De Luca', 'Direttrice editoriale', 1],
      ['Giulia Verdi', 'Fondatrice ed editrice', 2],
      ['Marco Neri', 'Ufficio stampa', 3],
    ],
  );
  assert.equal(people[0].email, 'anna.deluca@edizionirosse.it');
});

test('pagina con i ruoli sulla stessa riga, in tutti gli ordini', async () => {
  const people = extractPeople(await fixture('redazione.html'));
  assert.deepEqual(
    people.map((p) => [p.name, p.rank]),
    [
      ['Paola Gialli', 0],
      ['Anna De Luca', 1],
      ['Luca Bianchi', 1],
      ['Sara Rossi', 3],
    ],
  );
  assert.equal(people[0].email, 'p.gialli@edizionirosse.it');
});

test('link alle pagine del team: stesso sito, senza doppioni né social', async () => {
  assert.deepEqual(teamLinks(await fixture('home.html'), 'https://www.edizionirosse.it/'), [
    'https://www.edizionirosse.it/chi-siamo/',
    'https://www.edizionirosse.it/redazione',
    'https://www.edizionirosse.it/contatti',
  ]);
});

test('ricerca sul sito: home e pagine del team, persone unite; la persona a cui scrivere', async () => {
  const pages = {
    'https://www.edizionirosse.it/': await fixture('home.html'),
    'https://www.edizionirosse.it/chi-siamo/': await fixture('chi-siamo.html'),
    'https://www.edizionirosse.it/redazione': await fixture('redazione.html'),
  };
  const fetchText = async (url) => {
    if (!pages[url]) throw new Error('HTTP 404');
    return pages[url];
  };
  const { people, pages: visited } = await findPeople('https://www.edizionirosse.it/', fetchText);
  assert.deepEqual(visited, [
    'https://www.edizionirosse.it/',
    'https://www.edizionirosse.it/chi-siamo/',
    'https://www.edizionirosse.it/redazione',
  ]);
  const anna = people.filter((p) => p.name === 'Anna De Luca');
  assert.equal(anna.length, 1, 'la stessa persona su due pagine è una sola voce');
  assert.equal(anna[0].email, 'anna.deluca@edizionirosse.it');
  assert.equal(bestContact(people).name, 'Paola Gialli');
  assert.equal(bestContact([{ name: 'Marco Neri', rank: 3 }]), null, 'l’ufficio stampa non è la persona giusta');
  assert.match((await findPeople(null)).problem, /nessun sito/);
});

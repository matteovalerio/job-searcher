import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { autoConfig, autoPublishers } from '../src/publishers/auto.js';
import { Publishers } from '../src/publishers/store.js';
import {
  buildWatchMessage,
  compareSnapshots,
  describeEvent,
  loadWatch,
  saveWatch,
  snapshot,
  watchPublishers,
} from '../src/publishers/watch.js';

const careers = (offers) => `<html><body>
<nav><a href="/">Home</a> <a href="/contatti">Contatti</a> <a href="/lavora-con-noi">Lavora con noi</a></nav>
<main><h1>Lavora con noi</h1><p>Aggiornato il ${Math.floor(Math.random() * 28) + 1}/09/2026</p>
<ul>${offers.map((o) => `<li><a href="/lavora-con-noi/${o.replace(/\W+/g, '-')}">${o}</a></li>`).join('')}</ul>
</main><footer><a href="/privacy">Privacy</a></footer></body></html>`;

const home = (extra = '') => `<html><body><nav><a href="/catalogo">Catalogo</a></nav>
<main><h1>Edizioni Rosse</h1><p>Albi illustrati per ragazzi.</p>${extra}</main></body></html>`;

test('istantanea: annunci senza voci di menu, impronta che ignora date e numeri', () => {
  const a = snapshot(careers(['Redattore junior', 'Grafico impaginatore']), 'https://x.it/lavora-con-noi', 'careers');
  assert.deepEqual(
    a.items.map((i) => i.title),
    ['Redattore junior', 'Grafico impaginatore'],
  );
  const b = snapshot(careers(['Redattore junior', 'Grafico impaginatore']), 'https://x.it/lavora-con-noi', 'careers');
  assert.equal(a.hash, b.hash, 'cambia solo la data: stessa impronta');
  const h = snapshot(home('<p>Stiamo cercando un redattore per la collana ragazzi.</p>'), 'https://x.it/', 'home');
  assert.deepEqual(h.items, []);
  assert.match(h.hiring[0], /Stiamo cercando un redattore/);
});

test('confronto: nuovi annunci (pertinenti prima), avvisi, pagina trovata, pagina cambiata', () => {
  const url = 'https://x.it/lavora-con-noi';
  const before = snapshot(careers(['Grafico impaginatore']), url, 'careers');
  const after = snapshot(careers(['Grafico impaginatore', 'Redattrice junior', 'Magazziniere']), url, 'careers');
  const events = compareSnapshots(before, after, {
    keywords: [{ keyword: 'redattrice', re: /redattrice/ }],
  });
  assert.deepEqual(
    events.map((e) => [e.type, e.title, e.relevant]),
    [
      ['annuncio', 'Redattrice junior', true],
      ['annuncio', 'Magazziniere', false],
    ],
  );
  assert.deepEqual(compareSnapshots(null, after), [], "la prima volta si salva solo l'istantanea");

  const h1 = snapshot(home(), 'https://x.it/', 'home');
  const h2 = snapshot(home('<p>Cerchiamo un editor per la narrativa.</p>'), 'https://x.it/', 'home');
  assert.deepEqual(
    compareSnapshots(h1, h2).map((e) => e.type),
    ['avviso'],
  );
  assert.deepEqual(
    compareSnapshots(h1, before).map((e) => e.type),
    ['pagina-trovata'],
  );
  const changed = snapshot(
    careers(['Grafico impaginatore']).replace(
      'Lavora con noi</h1>',
      'Lavora con noi</h1><p>Candidature chiuse fino a gennaio.</p>',
    ),
    url,
    'careers',
  );
  assert.deepEqual(
    compareSnapshots(before, changed).map((e) => e.type),
    ['pagina-cambiata'],
  );
  assert.match(
    describeEvent({ type: 'annuncio', title: 'Redattrice', relevant: true }),
    /nuovo annuncio \(pertinente\)/,
  );
});

test('sorveglianza: due giri, novità al secondo, link "lavora con noi" seguito dalla home', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'watch-'));
  const store = new Publishers(path.join(dir, 'publishers.json'));
  store.add({ name: 'Edizioni Rosse', website: 'https://rosse.it' });
  store.add({ name: 'Studio Pagine', website: 'https://pagine.it' });
  const scartata = store.add({ name: 'Non interessa', website: 'https://no.it' });
  store.update(scartata.id, { status: 'scartata' });
  store.add({ name: 'Senza sito' });

  let round = 1;
  const pages = {
    1: {
      'https://rosse.it/': home('<a href="/lavora-con-noi">Lavora con noi</a>'),
      'https://rosse.it/lavora-con-noi': careers(['Grafico']),
      'https://pagine.it/': home(),
    },
    2: {
      'https://rosse.it/lavora-con-noi': careers(['Grafico', 'Redattore per albi illustrati']),
      'https://pagine.it/': home('<p>Selezioniamo correttori di bozze freelance.</p>'),
    },
  };
  const visited = [];
  const fetchText = async (url) => {
    visited.push(url);
    const page = pages[round][url];
    if (!page) throw new Error(`HTTP 404 su ${url}`);
    return page;
  };
  const state = { byId: {}, events: [] };
  const profile = { keywords: ['redatt*'] };
  const first = await watchPublishers(store, state, { fetchText, profile, now: '2026-09-29T08:00:00Z' });
  assert.equal(first.checked, 2);
  assert.deepEqual(first.events, []);
  assert.ok(!visited.includes('https://no.it/'), 'le aziende scartate non si sorvegliano');
  assert.equal(store.get('edizioni-rosse').careersUrl, 'https://rosse.it/lavora-con-noi');

  round = 2;
  const second = await watchPublishers(store, state, { fetchText, profile, now: '2026-09-30T08:00:00Z' });
  assert.deepEqual(
    second.events.map((e) => [e.name, e.type, e.relevant ?? null]),
    [
      ['Edizioni Rosse', 'annuncio', true],
      ['Studio Pagine', 'avviso', null],
    ],
  );
  assert.equal(state.events.length, 2);
  const file = path.join(dir, 'watch.json');
  await saveWatch(state, file);
  assert.equal((await loadWatch(file)).byId['edizioni-rosse'].kind, 'careers');
  assert.deepEqual(await loadWatch(path.join(dir, 'nessuno.json')), { byId: {}, events: [], lastDiscovery: null });

  const message = buildWatchMessage({
    events: second.events,
    added: [{ name: 'Idea Grafica', kind: 'agenzia-comunicazione', city: 'Padova', website: 'https://idea.it' }],
  });
  assert.equal(message.subject, '2 novità dalle aziende seguite, 1 aziende nuove');
  assert.match(message.text, /Edizioni Rosse: nuovo annuncio \(pertinente\): «Redattore per albi illustrati»/);
  assert.match(
    message.telegram[0],
    /<b>Aziende nuove \(da valutare\)<\/b>\n• <a href="https:\/\/idea.it">Idea Grafica<\/a>: agenzia di comunicazione · Padova/,
  );
  assert.equal(buildWatchMessage({}), null);
});

test('giro automatico: ricerca ogni 7 giorni nella zona del profilo, poi sorveglianza', async () => {
  const profile = {
    keywords: ['redattore'],
    targets: [{ type: 'area', places: ['Padova', 'Vicenza'], radiusKm: 35 }, { type: 'remote' }],
  };
  const cfg = autoConfig(profile);
  assert.deepEqual(cfg.places, ['Padova', 'Vicenza']);
  assert.equal(cfg.radiusKm, 35);
  assert.ok(cfg.sectors.includes('casa-editrice') && cfg.sectors.includes('libreria'));
  assert.deepEqual(autoConfig({ publishers: { places: ['Venezia'], radiusKm: 20, sectors: 'tipografia' } }).sectors, [
    'tipografia',
  ]);

  const dir = await mkdtemp(path.join(tmpdir(), 'auto-'));
  const store = new Publishers(path.join(dir, 'publishers.json'));
  const state = { byId: {}, events: [], lastDiscovery: null };
  const calls = [];
  const discover = async (opts) => {
    calls.push(opts.places.join(','));
    return {
      results: [
        { name: 'Idea Grafica', website: 'https://idea.it', kind: 'agenzia-comunicazione', source: 'openstreetmap' },
        { name: 'Senza Sito', kind: 'tipografia', source: 'openstreetmap' },
      ],
      problems: ['Wikidata (Padova): HTTP 429'],
    };
  };
  const check = async () => ({ email: 'lavoro@idea.it' });
  const watch = async () => ({ events: [], checked: 1, problems: [] });
  const run1 = await autoPublishers({
    profile,
    store,
    state,
    discover,
    check,
    watch,
    now: new Date('2026-09-29T08:00:00Z'),
  });
  assert.equal(run1.discovered, true);
  assert.deepEqual(
    run1.added.map((p) => p.name),
    ['Idea Grafica', 'Senza Sito'],
  );
  assert.equal(store.get('idea-grafica').email, 'lavoro@idea.it');
  assert.deepEqual(run1.problems, ['Wikidata (Padova): HTTP 429']);

  const run2 = await autoPublishers({
    profile,
    store,
    state,
    discover,
    check,
    watch,
    now: new Date('2026-10-02T08:00:00Z'),
  });
  assert.equal(run2.discovered, false, 'tre giorni dopo non si ricerca');
  const run3 = await autoPublishers({
    profile,
    store,
    state,
    discover,
    check,
    watch,
    now: new Date('2026-10-06T08:00:00Z'),
  });
  assert.equal(run3.discovered, true);
  assert.deepEqual(run3.added, [], 'le aziende già in elenco non si aggiungono di nuovo');
  assert.equal(calls.length, 2);
});

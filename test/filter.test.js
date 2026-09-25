import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe } from '../src/dedupe.js';
import { buildMatcher, evaluate, REJECT } from '../src/filter.js';
import { findComune } from '../src/geo.js';
import { makeJob } from '../src/job.js';
import { compileKeyword, normalize } from '../src/text.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');

const target = (overrides = {}) => ({
  type: 'area',
  keywords: ['redattore', 'redattrice', 'editor', 'correttore di bozze'],
  excludeKeywords: ['video'],
  boostKeywords: ['casa editrice', 'libri'],
  matchIn: 'title+description',
  maxAgeDays: 30,
  ...overrides,
});

const job = (fields) => makeJob('test', { postedAt: '2026-09-20', ...fields });

test('normalize e parole chiave: accenti, parole intere, prefissi', () => {
  assert.equal(normalize('  Città  EDITRICE '), 'citta editrice');
  assert.ok(compileKeyword('editor').test('copy editor'));
  assert.ok(!compileKeyword('editor').test('editoriale'));
  assert.ok(compileKeyword('redatt*').test('redattrice junior'));
  assert.ok(compileKeyword('correttore di bozze').test('correttore-di bozze'));
  assert.ok(compileKeyword('eu').test('remote (eu)'));
  assert.ok(!compileKeyword('eu').test('europe'));
});

test('punteggio: titolo pesa più della descrizione, bonus per il contesto', () => {
  const m = buildMatcher(target());
  const inTitle = evaluate(job({ title: 'Redattore', description: 'casa editrice di libri' }), m, NOW);
  const inBody = evaluate(job({ title: 'Assistente', description: 'supporto al redattore' }), m, NOW);
  assert.equal(inTitle.score, 10 + 2 + 2);
  assert.deepEqual(inTitle.matched, ['redattore']);
  assert.deepEqual(inTitle.boosted, ['casa editrice', 'libri']);
  assert.equal(inBody.score, 2);
});

test('scarta: parole escluse, nessuna corrispondenza, offerte vecchie', () => {
  const m = buildMatcher(target());
  assert.equal(evaluate(job({ title: 'Video Editor' }), m, NOW).rejected, 'parola esclusa nel titolo');
  assert.equal(evaluate(job({ title: 'Magazziniere' }), m, NOW).rejected, 'nessuna parola chiave');
  assert.equal(evaluate(job({ title: 'Redattore', postedAt: '2026-01-01' }), m, NOW).rejected, 'troppo vecchia');
  // Senza data non si può giudicare l'età: si tiene.
  assert.ok(!evaluate(job({ title: 'Redattore', postedAt: null }), m, NOW).rejected);
});

test('matchIn "title" ignora la descrizione', () => {
  const m = buildMatcher(target({ matchIn: 'title' }));
  assert.equal(
    evaluate(job({ title: 'Assistente', description: 'redattore' }), m, NOW).rejected,
    'nessuna parola chiave',
  );
});

test('remoto: controlla il flag e le restrizioni geografiche', () => {
  const m = buildMatcher(target({ type: 'remote' }));
  const remote = (location, extra = {}) => evaluate(job({ title: 'Editor', location, remote: true, ...extra }), m, NOW);
  assert.ok(!remote('Worldwide').rejected);
  assert.ok(!remote('Europe').rejected);
  assert.ok(!remote('Milano, Lombardia, Italia').rejected);
  assert.ok(!remote('').rejected);
  assert.ok(!remote('Segrate', { remote: true }).rejected, "località italiana: ok se l'Italia è accettata");
  assert.equal(remote('USA Only').rejected, REJECT.region);
  assert.equal(remote('Canada').rejected, REJECT.region);
  assert.equal(evaluate(job({ title: 'Editor', location: 'Italia', remote: null }), m, NOW).rejected, REJECT.notRemote);
  // "smart working" di solito significa ibrido: non basta.
  assert.equal(
    evaluate(job({ title: 'Editor', location: 'Milano', description: 'smart working 2 giorni' }), m, NOW).rejected,
    REJECT.notRemote,
  );
  // Se la fonte non lo dice, si guarda il testo dell'annuncio.
  assert.ok(
    !evaluate(job({ title: 'Editor', location: 'Italia', description: 'Lavoro full remote' }), m, NOW).rejected,
  );
});

test('dedupe: unisce la stessa offerta da fonti diverse', () => {
  const merged = dedupe([
    makeJob('linkedin', { title: 'Redattore/Redattrice', company: 'Edizioni Esempio S.r.l.', url: 'https://a' }),
    makeJob('jooble', { title: 'redattore / redattrice', company: 'Edizioni Esempio srl', url: 'https://b' }),
    makeJob('jooble', { title: 'Redattore', company: 'Altra', url: 'https://c' }),
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].alsoOn, [{ source: 'jooble', url: 'https://b' }]);
});

test('area: filtra per distanza reale dai luoghi cercati (casi reali)', () => {
  const m = buildMatcher(target({ places: [findComune('Padova'), findComune('Vicenza')], radiusKm: 35 }));
  const at = (location) => evaluate(job({ title: 'Redattore', location }), m, NOW).rejected;
  // Offerte che LinkedIn restituiva cercando "Padova"
  assert.equal(at('Milano'), REJECT.farAway);
  assert.equal(at('Segrate'), REJECT.farAway);
  assert.equal(at('Caronno Pertusella'), REJECT.farAway);
  assert.equal(at('Area metropolitana di Milano'), REJECT.farAway);
  // Offerte vicine, nei vari formati dei portali
  assert.equal(at('Padova, Veneto, Italia'), undefined);
  assert.equal(at('Castelfranco Veneto, Provincia di Treviso'), undefined);
  assert.equal(at('Montecchio Maggiore, Provincia di Vicenza'), undefined);
  assert.equal(at('Provincia di Vicenza, Veneto'), undefined);
  assert.equal(at('Abano Terme'), undefined);
  // Montagnana dista 36 km da Padova ma è in provincia: si tiene
  assert.equal(at('Montagnana (PD)'), undefined);
  assert.equal(at('Treviso, TV'), REJECT.farAway);
  assert.equal(at('Veneto'), undefined);
  // Non riconosciute: scartate di default, tenute con unknownLocation "keep"
  assert.equal(at('Italia'), REJECT.unknownPlace);
  const keep = buildMatcher(target({ places: [findComune('Padova')], radiusKm: 35, unknownLocation: 'keep' }));
  assert.equal(evaluate(job({ title: 'Redattore', location: 'Italia' }), keep, NOW).rejected, undefined);
});

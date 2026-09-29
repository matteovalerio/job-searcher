import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { buildMatcher, evaluate } from '../src/filter.js';
import { makeJob } from '../src/job.js';
import { buildKit, buildKitPrompt } from '../src/kit.js';
import { affineForProfile } from '../src/publishers/sectors.js';

const base = {
  name: 'Redattrice',
  description: 'Redazione, editoria scientifica, traduzione e localizzazione',
  keywords: ['redattore', 'redattrice', 'editor'],
  excludeKeywords: ['seo', 'stage'],
  matchIn: 'title',
  targets: [{ id: 'remoto', type: 'remote', searchKeywords: ['redattore', 'medical writer'], sources: ['remotive'] }],
};

test('settori affini: scelti dal profilo, indicati a mano o spenti', () => {
  const auto = affineForProfile(base).map((s) => s.id);
  assert.equal(auto.length, 3);
  assert.ok(auto.includes('comunicazione-scientifica'));
  assert.ok(auto.includes('traduzioni'));
  assert.deepEqual(
    affineForProfile({ ...base, affine: { sectors: ['agenzia-comunicazione'] } }).map((s) => s.id),
    ['agenzia-comunicazione'],
  );
  assert.deepEqual(affineForProfile({ ...base, affine: { sectors: 'no' } }), []);
  assert.throws(() => affineForProfile({ ...base, affine: { sectors: ['boh'] } }), /Settore affine sconosciuto "boh"/);
});

test('ricerche in più: i titoli affini, a rotazione, senza doppioni e con un tetto', () => {
  const profile = { ...base, affine: { sectors: ['comunicazione-scientifica', 'agenzia-comunicazione'], queries: 3 } };
  const [target] = resolveProfile(profile).targets;
  // Primo giro: "medical writer" c'è già, poi "copywriter"; secondo giro: un titolo per settore, fino a 3.
  assert.deepEqual(target.queryKeywords, [
    'redattore',
    'medical writer',
    'copywriter',
    'scientific writer',
    'content writer',
  ]);
  assert.deepEqual(resolveProfile({ ...profile, affine: { sectors: 'no' } }).targets[0].queryKeywords, [
    'redattore',
    'medical writer',
  ]);
});

test('filtro: un titolo affine resta, segnato con il settore; le parole principali vincono; le esclusioni valgono', () => {
  const [target] = resolveProfile({
    ...base,
    affine: { sectors: ['agenzia-comunicazione', 'documentazione-tecnica'] },
  }).targets;
  const m = buildMatcher(target);
  const job = (title) => makeJob('t', { title, location: 'Remote', remote: true, postedAt: new Date().toISOString() });

  const copy = evaluate(job('Copywriter per agenzia'), m);
  assert.ok(!copy.rejected);
  assert.deepEqual(copy.affine, {
    id: 'agenzia-comunicazione',
    one: 'agenzia di comunicazione',
    why: copy.affine.why,
    match: 'copywriter',
  });
  assert.equal(copy.score, 5);
  assert.ok(copy.warnings.includes('affine · agenzia di comunicazione'));

  const tech = evaluate(job('Technical Writer'), m);
  assert.equal(tech.affine.id, 'documentazione-tecnica');

  const main = evaluate(job('Editor e copywriter'), m);
  assert.equal(main.affine, undefined, 'con una parola principale nel titolo non è "affine"');
  assert.ok(main.score >= 10);

  assert.equal(evaluate(job('SEO copywriter'), m).rejected, 'parola esclusa nel titolo');
  assert.equal(evaluate(job('Magazziniere'), m).rejected, 'nessuna parola chiave');
});

test('kit di un’offerta affine: il CV valorizza ciò che conta nel settore, il prompt lo dice', () => {
  const affine = {
    id: 'documentazione-tecnica',
    one: 'azienda di documentazione tecnica',
    why: 'scrivono manuali',
    match: 'technical writer',
  };
  const kit = buildKit({
    job: { id: 'x', title: 'Technical Writer', company: 'UNOX S.p.A.', url: 'https://x', source: 'linkedin', affine },
    text: 'Requisiti: redazione di manuali',
    cvText: '',
  });
  assert.equal(kit.company.kind, 'documentazione-tecnica');
  assert.equal(kit.company.kindLabel, 'azienda di documentazione tecnica');
  assert.ok(kit.emphasis.focus.length > 0, 'il focus del settore');
  assert.match(
    buildKitPrompt(kit, ''),
    /È UN RUOLO DI UN SETTORE AFFINE \(azienda di documentazione tecnica\): scrivono manuali/,
  );
});

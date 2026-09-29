import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applySuggestion,
  describeSuggestion,
  dismissSuggestion,
  loadDismissed,
  resultJobs,
  suggestFromChoices,
  titleTerms,
} from '../src/learn.js';

const item = (id, title, status) => ({ job: { id, title }, status });
const profile = {
  keywords: ['redattore', 'redattrice', 'editor', 'correttore di bozze'],
  excludeKeywords: ['stage'],
  boostKeywords: ['casa editrice'],
};
const tracking = [
  item('1', 'Redattore commerciale', 'scartata'),
  item('2', 'Editor commerciale e vendite', 'scartata'),
  item('3', 'Redattrice area commerciale - Milano', 'scartata'),
  item('4', 'Redattore stage', 'scartata'),
  item('5', 'Social media editor', 'scartata'),
  item('6', 'Redattrice libri per ragazzi', 'interessante'),
  item('7', 'Editor narrativa ragazzi', 'candidatura'),
  item('8', 'Redattore scolastico', 'colloquio'),
  item('9', 'Redattore scolastico junior', 'scartata'),
];

test('parole dei titoli: senza parole vuote, numeri e sigle; con le coppie', () => {
  assert.deepEqual(titleTerms('Redattore/Redattrice (m/f) - Social Media 2026'), [
    'redattore',
    'redattrice',
    'social',
    'media',
    'redattore redattrice',
    'social media',
  ]);
});

test('proposte: esclude le parole scartate spesso, premia quelle seguite; mai parole chiave o comuni', () => {
  const jobs = [
    { id: 'a', title: 'Redattore commerciale junior' },
    { id: 'b', title: 'Editor ragazzi' },
    { id: '1', title: 'Redattore commerciale' }, // già scartata: non conta
  ];
  const list = suggestFromChoices({ tracking, profile, jobs });
  assert.deepEqual(
    list.map((s) => [s.id, s.count, s.affects]),
    [
      ['exclude:commerciale', 3, 1],
      ['boost:ragazzi', 2, 1],
    ],
  );
  // «milano» (un comune), «stage» (già esclusa), «redattore» (parola chiave), «scolastico» (anche seguita): no.
  assert.equal(list[0].examples.length, 3);

  const text = describeSuggestion(list[0]);
  assert.equal(text.title, 'Escludere «commerciale»?');
  assert.match(text.text, /«non mi interessa» 3 offerte .* Negli ultimi risultati ne toglierebbe 1\./);
  assert.match(describeSuggestion(list[1]).text, /^Segui 2 offerte con «ragazzi»/);

  // Rifiutata una volta, non torna.
  assert.deepEqual(
    suggestFromChoices({ tracking, profile, jobs, dismissed: ['exclude:commerciale'] }).map((s) => s.id),
    ['boost:ragazzi'],
  );
});

test('coppie di parole solo se dicono più delle singole', () => {
  const t = [
    item('1', 'Social media manager', 'scartata'),
    item('2', 'Social media specialist', 'scartata'),
    item('3', 'Social media coordinator', 'scartata'),
    item('4', 'Social impact editor', 'interessante'),
  ];
  const ids = suggestFromChoices({ tracking: t, profile }).map((s) => s.id);
  // «social» compare anche in un'offerta seguita; «media» copre le stesse offerte di «social media», più precisa.
  assert.deepEqual(ids, ['exclude:social media']);
});

test('applicare una proposta: il profilo ha la parola in più, una volta sola', () => {
  const p1 = applySuggestion(profile, { kind: 'exclude', term: 'commerciale' });
  assert.deepEqual(p1.excludeKeywords, ['stage', 'commerciale']);
  assert.deepEqual(profile.excludeKeywords, ['stage'], "l'originale non cambia");
  assert.equal(applySuggestion(p1, { kind: 'exclude', term: 'Commerciale' }), p1);
  assert.deepEqual(applySuggestion({}, { kind: 'boost', term: 'ragazzi' }).boostKeywords, ['ragazzi']);
});

test('ultimi risultati e proposte rifiutate salvate per profilo', async () => {
  const jobs = resultJobs({ targets: [{ jobs: [{ id: 'a' }, { id: 'b' }] }, { jobs: [{ id: 'a' }] }] });
  assert.deepEqual(
    jobs.map((j) => j.id),
    ['a', 'b'],
  );
  process.env.JOB_SEARCHER_HOME = await mkdtemp(path.join(tmpdir(), 'learn-'));
  assert.deepEqual(await loadDismissed('p'), []);
  await dismissSuggestion('p', 'exclude:commerciale');
  await dismissSuggestion('p', 'exclude:commerciale');
  await dismissSuggestion('q', 'boost:ragazzi');
  assert.deepEqual(await loadDismissed('p'), ['exclude:commerciale']);
  assert.deepEqual(await loadDismissed('q'), ['boost:ragazzi']);
});

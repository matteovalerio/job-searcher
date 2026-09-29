import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeJob } from '../src/job.js';
import { buildMatchPrompt, pickJobs } from '../src/match.js';
import { shortId } from '../src/tracking.js';

const job = (title, score, extra = {}) => ({
  ...makeJob('x', {
    id: title,
    title,
    company: 'Editore',
    location: 'Padova',
    url: `https://x/${title}`,
    description: 'd'.repeat(900),
  }),
  score,
  ...extra,
});
const last = {
  targets: [
    { target: { label: 'Padova' }, jobs: [job('A', 10), job('B', 25), job('C', 5)] },
    { target: { label: 'Remoto' }, jobs: [job('B', 25), job('D', 20)] },
  ],
};

test('match: le migliori per punteggio, senza doppioni e senza quelle nascoste', () => {
  assert.deepEqual(
    pickJobs(last, { top: 3 }).map((j) => j.title),
    ['B', 'D', 'A'],
  );
  assert.deepEqual(
    pickJobs(last, { top: 3, hidden: (j) => j.title === 'D' }).map((j) => j.title),
    ['B', 'A', 'C'],
  );
  assert.deepEqual(
    pickJobs(last, { ids: [shortId('x:C')] }).map((j) => j.title),
    ['C'],
  );
  assert.throws(() => pickJobs(last, { ids: ['0000000'] }), /non trovate.*0000000/);
});

test('match: prompt con codici, CV o sintesi del profilo, descrizioni accorciate', () => {
  const jobs = pickJobs(last, { top: 2 });
  const profile = { description: '7 anni in redazione', keywords: ['redattore'], candidate: { years: 7 } };
  const withSummary = buildMatchPrompt({ profile, jobs });
  assert.match(withSummary, /CV del candidato è allegato/);
  assert.match(withSummary, /Anni di esperienza: 7/);
  assert.match(withSummary, new RegExp(`### \\[${shortId('x:B')}\\] B`));
  assert.ok(!withSummary.includes('d'.repeat(701)), 'descrizioni accorciate');
  const withCv = buildMatchPrompt({ profile, jobs, cvText: 'Giulia, redattrice' });
  assert.match(withCv, /<cv>\nGiulia, redattrice\n<\/cv>/);
  assert.throws(() => buildMatchPrompt({ profile, jobs: [] }), /lancia prima una ricerca/);
});

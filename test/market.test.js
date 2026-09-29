import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MARKET_SKILLS } from '../src/market/catalog.js';
import {
  analyzeMarket,
  buildMarketPrompt,
  cefrLevel,
  findSkills,
  jobFeatures,
  loadHistory,
  updateHistory,
} from '../src/market/index.js';

const LONG =
  ' Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'.repeat(
    2,
  );

const job = (id, description, info = {}) => ({
  id,
  title: 'Redattore',
  company: 'Editore',
  source: 'linkedin',
  description: description + LONG,
  info: { contracts: [], ...info },
});

const JOBS = [
  job('1', 'Cerchiamo redattore con ottima conoscenza di Adobe InDesign e inglese C1. Correzione di bozze.', {
    yearsRequired: 3,
    contracts: ['indeterminato'],
    salary: { currency: 'EUR', annualMin: 26000, annualMax: 30000 },
  }),
  job('2', 'Redattrice per riviste scientifiche: peer review, LaTeX, inglese fluente. Uso di InDesign gradito.', {
    yearsRequired: 5,
    contracts: ['determinato'],
  }),
  job('3', 'Editor per la narrativa, correzione bozze e rapporti con gli autori. Inglese B2.', { yearsRequired: 2 }),
  job('4', 'Grafico impaginatore: InDesign, Photoshop, Illustrator. Patente B.', { seniority: 'junior' }),
  { id: '5', title: 'Redattore', description: 'breve', info: { contracts: [] } },
];

const CV = `Giulia Esempio
ESPERIENZA
2020-oggi Redattrice, casa editrice scientifica: correzione di bozze, rapporti con gli autori, peer review.
COMPETENZE
Word, Excel
LINGUE
Inglese B2`;

test('livelli di lingua', () => {
  assert.equal(cefrLevel(' (C1)'), 'C1');
  assert.equal(cefrLevel('fluente'), 'C1');
  assert.equal(cefrLevel('madrelingua'), 'C2');
  assert.equal(cefrLevel('buona conoscenza'), 'B2');
  assert.equal(cefrLevel(''), null);
});

test('catalogo completo e competenze riconosciute', () => {
  for (const s of MARKET_SKILLS) assert.ok(s.id && s.label && s.detect.length && s.learn.length && s.show, s.id);
  assert.deepEqual(findSkills('Uso di Adobe InDesign e LaTeX').sort(), ['indesign', 'latex']);
  const f = jobFeatures(JOBS[0]);
  assert.ok(f.skills.includes('indesign') && f.skills.includes('correzione-bozze'));
  assert.deepEqual(f.languages, [{ name: 'inglese', level: 'C1' }]);
  assert.deepEqual(f.salary, { min: 26000, max: 30000 });
  assert.equal(f.hasDescription, true);
  assert.equal(jobFeatures(JOBS[4]).hasDescription, false);
});

test('analisi: cosa chiedono gli annunci, confronto con il CV, lacune con il piano', () => {
  const a = analyzeMarket(JOBS.map(jobFeatures), CV);
  assert.equal(a.total, 4);
  assert.equal(a.withoutDescription, 1);
  const indesign = a.skills.find((s) => s.id === 'indesign');
  assert.equal(indesign.count, 3);
  assert.equal(indesign.share, 0.75);
  assert.equal(indesign.inCv, false);
  assert.ok(a.strengths.some((s) => s.id === 'correzione-bozze'));
  const gap = a.gaps.find((g) => g.id === 'indesign');
  assert.equal(gap.priority, 'alta');
  assert.ok(gap.learn.length && gap.show);
  assert.ok(!a.gaps.some((g) => g.id === 'correzione-bozze'), 'ciò che è nel CV non è una lacuna');
  const en = a.languages.find((l) => l.name === 'inglese');
  assert.equal(en.count, 3);
  assert.equal(en.typical, 'C1');
  assert.equal(en.cvLevel, 'B2');
  assert.equal(a.languageGaps[0].name, 'inglese');
  assert.match(a.languageGaps[0].learn, /Cambridge/);
  assert.equal(a.experience.median, 3);
  assert.deepEqual(
    a.experience.buckets.map((b) => b.count),
    [1, 2, 0, 0],
  );
  assert.deepEqual(a.contracts, [
    { value: 'indeterminato', count: 1 },
    { value: 'determinato', count: 1 },
  ]);
  assert.deepEqual(a.salary, { count: 1, min: 28000, median: 28000, max: 28000 });
  assert.deepEqual(analyzeMarket(JOBS.map(jobFeatures)).gaps, [], 'senza CV non ci sono lacune');
});

test('storico: si accumula, si aggiorna e dimentica le offerte vecchie', async () => {
  process.env.JOB_SEARCHER_HOME = await mkdtemp(path.join(tmpdir(), 'market-'));
  await updateHistory('p', [{ jobs: JOBS.slice(0, 2) }], new Date('2026-01-01T00:00:00Z'));
  await updateHistory('p', [{ jobs: JOBS.slice(1, 4) }], new Date('2026-07-15T00:00:00Z'));
  const h = await loadHistory('p');
  assert.deepEqual(Object.keys(h.jobs).sort(), ['2', '3', '4'], "l'offerta vista solo a gennaio è dimenticata");
  assert.equal(h.jobs['2'].firstSeen, '2026-01-01T00:00:00.000Z');
  delete process.env.JOB_SEARCHER_HOME;
});

test('prompt per il piano personale', () => {
  const a = analyzeMarket(JOBS.map(jobFeatures), CV);
  const prompt = buildMarketPrompt({ analysis: a, cvText: CV, profileName: 'Redattore' });
  assert.match(prompt, /Ho analizzato 4 annunci/);
  assert.match(prompt, /Adobe InDesign: 3 annunci \(75%\), NON nel CV/);
  assert.match(prompt, /inglese: 3 annunci \(75%\), livello tipico C1; nel mio CV: B2/);
  assert.match(prompt, /Non inventare corsi/);
  assert.match(prompt, /<cv>/);
});

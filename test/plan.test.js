import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applications, buildPlan, loadPlan, planMessage, savePlan, weekStart } from '../src/plan.js';

const job = (id, source, extra = {}) => ({
  shortId: id,
  job: { id, title: `Offerta ${id}`, company: `Azienda ${id}`, source, url: `https://x/${id}`, score: 10 },
  history: [],
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
  ...extra,
});
const h = (status, at) => ({ status, at });

// Mercoledì 30 settembre 2026: la settimana va da lunedì 28 a domenica 4 ottobre.
const NOW = new Date('2026-09-30T10:00:00Z');
const tracking = [
  // Inviata tre settimane fa su LinkedIn, colloquio dopo 6 giorni.
  job('a', 'linkedin', {
    status: 'colloquio',
    sentAt: '2026-09-08',
    history: [
      h('interessante', '2026-09-07T09:00:00Z'),
      h('candidatura', '2026-09-08T09:00:00Z'),
      h('colloquio', '2026-09-14T09:00:00Z'),
    ],
  }),
  // Inviata su LinkedIn, nessuna risposta, sollecito scaduto.
  job('b', 'linkedin', {
    status: 'candidatura',
    sentAt: '2026-09-10',
    followUpAt: '2026-09-17',
    followUps: [],
    history: [h('candidatura', '2026-09-10T09:00:00Z')],
  }),
  // Inviata su InfoJobs, risposta negativa.
  job('c', 'infojobs', {
    status: 'rifiutata',
    sentAt: '2026-09-02',
    history: [h('candidatura', '2026-09-02T09:00:00Z'), h('rifiutata', '2026-09-12T09:00:00Z')],
  }),
  // Inviate questa settimana (vecchie versioni: senza sentAt, vale la cronologia).
  job('d', 'linkedin', { status: 'candidatura', history: [h('candidatura', '2026-09-28T09:00:00Z')] }),
  job('e', 'linkedin', {
    status: 'candidatura',
    sentAt: '2026-09-29',
    followUps: ['2026-09-30'],
    history: [h('candidatura', '2026-09-29T09:00:00Z')],
  }),
  // Solo interessante: da fare.
  job('f', 'jooble', { status: 'interessante', history: [h('interessante', '2026-09-20T09:00:00Z')] }),
];
const publishers = [
  {
    id: 'rosse',
    name: 'Edizioni Rosse',
    kind: 'casa-editrice',
    status: 'colloquio',
    sentAt: '2026-09-01',
    history: [h('inviata', '2026-09-01T09:00:00Z'), h('colloquio', '2026-09-11T09:00:00Z')],
  },
  {
    id: 'stampa',
    name: 'Tipografia Veneta',
    kind: 'tipografia',
    status: 'inviata',
    sentAt: '2026-09-29',
    followUpAt: '2026-10-20',
    history: [h('inviata', '2026-09-29T09:00:00Z')],
  },
  {
    id: 'vecchia',
    name: 'Studio Pagine',
    kind: 'studio-editoriale',
    status: 'inviata',
    sentAt: '2026-09-01',
    followUpAt: '2026-09-22',
    history: [h('inviata', '2026-09-01T09:00:00Z')],
  },
  {
    id: 'nuova',
    name: 'Agenzia Blu',
    kind: 'agenzia-comunicazione',
    status: 'da_contattare',
    email: 'info@blu.it',
    history: [],
  },
];

test('settimana da lunedì, anche a cavallo del mese', () => {
  assert.equal(weekStart('2026-09-30'), '2026-09-28');
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
});

test('candidature da offerte e spontanee in una forma sola, con risposte e colloqui', () => {
  const list = applications(tracking, publishers);
  assert.equal(list.length, 8, 'la f è solo interessante, la «nuova» da contattare');
  const a = list.find((x) => x.id === 'a');
  assert.deepEqual([a.channel, a.response, a.interview], ['LinkedIn', { at: '2026-09-14', positive: true }, true]);
  assert.equal(list.find((x) => x.id === 'd').sentAt, '2026-09-28');
  const rosse = list.find((x) => x.id === 'rosse');
  assert.deepEqual([rosse.kind, rosse.channel, rosse.sector], ['spontanea', 'Candidatura spontanea', 'casa editrice']);
});

test('piano: settimana, cose da fare, statistiche per canale e per settore', () => {
  const plan = buildPlan({ tracking, publishers, goals: { applications: 5, spontaneous: 3 }, now: NOW });
  assert.deepEqual(plan.week.applications, { done: 2, goal: 5 });
  assert.deepEqual(plan.week.spontaneous, { done: 1, goal: 3 });
  assert.equal(plan.week.followUps.done, 1);
  assert.deepEqual(
    plan.todo.followUps.map((f) => f.id),
    ['b', 'vecchia'],
  );
  assert.deepEqual(
    plan.todo.toApply.map((t) => t.id),
    ['f'],
  );
  assert.deepEqual(plan.todo.toContact, [
    { id: 'nuova', title: 'Agenzia Blu', sector: 'agenzia di comunicazione', email: 'info@blu.it' },
  ]);

  const { overall, byChannel, bySector, weeks } = plan.stats;
  assert.equal(overall.sent, 8);
  assert.equal(overall.responses, 3);
  assert.equal(overall.interviews, 2);
  // Nel tasso contano solo le candidature di almeno una settimana (a, b, c, rosse, vecchia): 3 risposte su 5.
  assert.equal(overall.responseRate, 3 / 5);
  assert.equal(overall.medianDays, 10);
  const linkedin = byChannel.find((c) => c.name === 'LinkedIn');
  assert.deepEqual([linkedin.sent, linkedin.responses, linkedin.interviews], [4, 1, 1]);
  assert.deepEqual(
    bySector.map((s) => [s.name, s.sent, s.interviews]),
    [
      ['casa editrice', 1, 1],
      ['studio editoriale', 1, 0],
      ['tipografia', 1, 0],
    ],
  );
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.at(-1), { start: '2026-09-28', applications: 2, spontaneous: 1 });
  assert.match(plan.advice[0], /mancano 3 candidature a offerte e 2 spontanee/);

  const message = planMessage(plan);
  assert.match(message.text, /Candidature a offerte: 2\/5/);
  assert.match(message.text, /Da sollecitare:\n- Offerta b \(Azienda b\)\n- Studio Pagine/);
});

test('obiettivi: predefiniti, salvati, e numeri non validi rifiutati', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'plan-')), 'plan.json');
  assert.deepEqual(await loadPlan(file), { goals: { applications: 5, spontaneous: 3 } });
  await savePlan({ goals: { applications: '8', spontaneous: 2 } }, file);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { goals: { applications: 8, spontaneous: 2 } });
  assert.deepEqual(await loadPlan(file), { goals: { applications: 8, spontaneous: 2 } });
  await assert.rejects(savePlan({ goals: { applications: -1, spontaneous: 2 } }, file), /non valido/);
});

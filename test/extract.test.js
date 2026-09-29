import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeInfo, extractInfo, parseSalary, yearsRequired } from '../src/extract.js';
import { buildMatcher, evaluate, REJECT } from '../src/filter.js';
import { makeJob } from '../src/job.js';
import { normalize } from '../src/text.js';

const info = (title, description = '', salary = '') => extractInfo(makeJob('x', { title, description, salary }));

test('livello: dal titolo, dalla descrizione solo se esplicito', () => {
  assert.equal(info('Redattore junior').seniority, 'junior');
  assert.equal(info('Senior Copy Editor').seniority, 'senior');
  assert.equal(info('Caporedattrice').seniority, 'senior');
  assert.equal(info('Stage in redazione').seniority, 'stage');
  assert.equal(info('Redattrice', 'Cerchiamo un profilo junior').seniority, 'junior');
  // "responsabile" nel testo non basta a dire che è un ruolo senior
  assert.equal(info('Redattrice', 'Riporterai al responsabile editoriale').seniority, null);
});

test('anni di esperienza richiesti, solo se legati a "esperienza"', () => {
  const y = (t) => yearsRequired(normalize(t));
  assert.equal(y('richiesta esperienza di almeno 3 anni'), 3);
  assert.equal(y('5-7 anni di esperienza nel ruolo'), 5);
  assert.equal(y('3+ years of experience in publishing'), 3);
  assert.equal(y('minimum 2 years experience'), 2);
  assert.equal(y('casa editrice da 60 anni sul mercato'), null);
  assert.equal(y('azienda con 25 anni di esperienza nel settore'), null, "numeri alti: storia dell'azienda");
  assert.equal(y('età 30 anni'), null);
});

test('contratto e orario', () => {
  assert.deepEqual(info('Redattore', 'Contratto a tempo indeterminato, full-time').contracts, ['indeterminato']);
  assert.equal(info('Redattore', 'Contratto a tempo indeterminato, full-time').workTime, 'full-time');
  assert.deepEqual(info('Editor (Contract)').contracts, ['autonomo']);
  assert.deepEqual(info('Correttore di bozze', 'collaborazione con partita IVA').contracts, ['autonomo']);
  assert.deepEqual(info('Redattrice', 'sostituzione maternità, part time').contracts, ['determinato']);
  assert.equal(info('Redattrice', 'sostituzione maternità, part time').workTime, 'part-time');
  assert.deepEqual(info('Redattore', 'Assunzione in somministrazione').contracts, ['somministrazione']);
});

test('stipendio: formati italiani e inglesi, con stima annua', () => {
  const s = (field, text = '') => parseSalary(field, text);
  assert.deepEqual(s('', 'RAL 24.000 - 28.000 €'), {
    min: 24000,
    max: 28000,
    currency: 'EUR',
    period: 'anno',
    annualMin: 24000,
    annualMax: 28000,
  });
  assert.deepEqual(s('', 'RAL 28-32k'), {
    min: 28000,
    max: 32000,
    currency: 'EUR',
    period: 'anno',
    annualMin: 28000,
    annualMax: 32000,
  });
  assert.deepEqual(s('', 'Retribuzione 1.600 € - 1.900 € al mese'), {
    min: 1600,
    max: 1900,
    currency: 'EUR',
    period: 'mese',
    annualMin: 19200,
    annualMax: 22800,
  });
  assert.deepEqual(s('30000-40000 USD'), {
    min: 30000,
    max: 40000,
    currency: 'USD',
    period: 'anno',
    annualMin: 30000,
    annualMax: 40000,
  });
  assert.deepEqual(s('', 'Pay: $25-30 per hour'), { min: 25, max: 30, currency: 'USD', period: 'ora' });
  assert.equal(s('', 'Nessuna indicazione economica'), null);
});

test('descrizione breve', () => {
  assert.equal(
    describeInfo(
      info('Redattore junior', 'almeno 2 anni di esperienza, tempo determinato, part-time. RAL 24.000 - 28.000 €'),
    ),
    'junior · 2+ anni · determinato · part-time · 24k-28k €/anno',
  );
  assert.equal(describeInfo(info('Stage in redazione')), 'stage');
  assert.equal(describeInfo(null), '');
});

test('filtri del profilo: esperienza, livello, contratto, stipendio; mai per informazioni mancanti', () => {
  const m = buildMatcher({
    type: 'area',
    keywords: ['redattore'],
    matchIn: 'title',
    filters: {
      maxYearsRequired: 8,
      excludeSeniority: ['stage'],
      excludeContracts: ['stage', 'somministrazione'],
      minSalary: 22000,
    },
  });
  const at = (title, description = '') => evaluate(makeJob('x', { title, description }), m).rejected;
  assert.equal(at('Redattore', 'almeno 10 anni di esperienza'), REJECT.tooExperienced);
  assert.equal(at('Redattore', '5 anni di esperienza'), undefined);
  assert.equal(at('Stage redattore'), REJECT.seniority);
  assert.equal(at('Redattore', 'contratto in somministrazione'), REJECT.contract);
  assert.equal(
    at('Redattore', 'somministrazione finalizzata al tempo indeterminato'),
    undefined,
    'non solo contratti esclusi',
  );
  assert.equal(at('Redattore', 'RAL 18.000 €'), REJECT.lowSalary);
  assert.equal(at('Redattore', 'RAL 18.000 - 24.000 €'), undefined, 'il massimo supera la soglia');
  assert.equal(at('Redattore', 'Salary $15k'), undefined, 'valuta diversa: non si confronta');
  assert.equal(at('Redattore'), undefined, 'nessuna informazione: si tiene');
  const kept = evaluate(makeJob('x', { title: 'Redattore', description: 'tempo indeterminato' }), m);
  assert.deepEqual(kept.info.contracts, ['indeterminato']);
});

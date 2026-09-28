import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, checkImported, extractJson } from '../src/profiles/prompt.js';

const PROFILE = {
  name: 'Redattrice - Padova',
  keywords: ['redattrice', 'editor'],
  targets: [{ type: 'area', places: ['Padova'], radiusKm: 30 }],
};

test('prompt: con il testo del CV o chiedendo di allegarlo', () => {
  const withCv = buildPrompt({ cvText: 'Giulia Esempio\nRedattrice' });
  assert.match(withCv, /<cv>\nGiulia Esempio\nRedattrice\n<\/cv>/);
  assert.doesNotMatch(withCv, /allegato/);
  assert.match(buildPrompt(), /Il CV del candidato è allegato/);
});

test("prompt: l'esempio incluso è un profilo valido", () => {
  const example = extractJson(buildPrompt());
  assert.doesNotThrow(() => checkImported(example));
  // i valori per il remoto indicati a Claude sono quelli che il programma usa davvero
  assert.match(buildPrompt(), /Italia ed Europa: acceptedRegions \["italy","italia","europe"/);
});

test('import: estrae il JSON dalla risposta di Claude', () => {
  const answer = `Ecco il profilo:\n\n\`\`\`json\n${JSON.stringify(PROFILE, null, 2)}\n\`\`\`\n\nVa bene?`;
  assert.deepEqual(extractJson(answer), PROFILE);
  // senza blocco di codice
  assert.deepEqual(extractJson(`Ecco: ${JSON.stringify(PROFILE)} fine`), PROFILE);
  // con più blocchi vale l'ultimo (la versione corretta)
  const fixed = { ...PROFILE, name: 'Corretto' };
  const two = `\`\`\`json\n${JSON.stringify(PROFILE)}\n\`\`\`\ncorreggo:\n\`\`\`json\n${JSON.stringify(fixed)}\n\`\`\``;
  assert.equal(extractJson(two).name, 'Corretto');
  assert.throws(() => extractJson('non ho capito'), /non c'è nessun profilo JSON/);
  assert.throws(() => extractJson('```json\n{ "name": \n```'), /Non trovo un profilo JSON valido/);
});

test('import: completa i valori mancanti e segnala gli errori in modo comprensibile', () => {
  const profile = checkImported(PROFILE);
  assert.equal(profile.matchIn, 'title');
  assert.deepEqual(profile.customSources, []);
  assert.throws(() => checkImported({ ...PROFILE, name: '' }), /Manca "name"/);
  assert.throws(() => checkImported({ ...PROFILE, keywords: [] }), /Manca la lista "keywords"/);
  assert.throws(() => checkImported({ ...PROFILE, boostKeywords: 'libri' }), /"boostKeywords" deve essere una lista/);
  assert.throws(
    () => checkImported({ ...PROFILE, targets: [{ type: 'area', places: ['Padovva'] }] }),
    /comune "Padovva" non trovato/,
  );
});

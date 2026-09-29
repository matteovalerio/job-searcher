import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { buildProfile, suggest } from '../src/profiles/builder.js';
import {
  analyzeCv,
  findCity,
  findEducation,
  findLanguages,
  readCvText,
  yearsOfExperience,
} from '../src/profiles/cv.js';
import { listProfiles, loadProfile, profilePath, saveProfile, slugify } from '../src/profiles/store.js';
import { editList, parseChoices, runWizard } from '../src/profiles/wizard.js';
import { normalize } from '../src/text.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const CV = new URL('./fixtures/cv-esempio.pdf', import.meta.url).pathname;

async function withProfilesDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'profiles-'));
  const previous = process.env.JOB_SEARCHER_PROFILES;
  process.env.JOB_SEARCHER_PROFILES = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.JOB_SEARCHER_PROFILES;
    else process.env.JOB_SEARCHER_PROFILES = previous;
  }
}

/** Finta console: risponde con le risposte date, in ordine, e registra le domande. */
function scriptedIo(answers) {
  const queue = [...answers];
  const out = [];
  return {
    out,
    ask: async (q) => {
      out.push(q);
      if (!queue.length) throw new Error(`risposte finite alla domanda: ${q}`);
      return queue.shift();
    },
    print: (s) => out.push(s),
  };
}

test('cv: legge il PDF e ne ricava le informazioni principali', async () => {
  const cv = analyzeCv(await readCvText(CV), { now: NOW });
  assert.deepEqual(
    cv.families.slice(0, 2).map((f) => f.id),
    ['editoria', 'scientifica'],
  );
  assert.equal(cv.years, 7, 'dal 03/2020 a oggi, senza contare lo stage');
  assert.deepEqual(cv.education, [
    { level: 'Laurea magistrale', field: 'linguistica' },
    { level: 'Laurea triennale', field: 'lettere' },
  ]);
  assert.deepEqual(
    cv.languages.map((l) => [l.name, l.level, l.good]),
    [
      ['italiano', 'madrelingua', true],
      ['inglese', 'c1', true],
      ['tedesco', 'a2', false],
    ],
  );
  assert.ok(cv.skills.includes('indesign'));
  assert.equal(cv.city.name, 'Padova');
});

test('cv: file mancante o non PDF', async () => {
  await assert.rejects(readCvText('non-esiste.pdf'), /file non trovato/);
  const dir = await mkdtemp(path.join(tmpdir(), 'cv-'));
  const fake = path.join(dir, 'cv.pdf');
  await writeFile(fake, 'non sono un pdf');
  await assert.rejects(readCvText(fake), /non sembra un PDF valido/);
});

test('cv: anni di esperienza con periodi sovrapposti, mesi e "presente"', () => {
  const text = normalize('01/2015 - 12/2017 redattrice\n06/2017 - 05/2019 editor\n2021 - presente copy editor');
  // 2015-01..2019-05 = 4 anni e 4 mesi, 2021-01..2026-08 = 5 anni e 8 mesi -> 10
  assert.equal(yearsOfExperience(text, NOW), 10);
  assert.equal(yearsOfExperience(normalize('2019 - 2020 stage in redazione'), NOW), 0);
});

test('cv: titoli di studio, lingue e città in formati diversi', () => {
  assert.deepEqual(findEducation(normalize("Master's degree in Comparative Literature, University of Bologna")), [
    { level: 'Laurea magistrale', field: 'comparative literature' },
  ]);
  assert.deepEqual(
    findLanguages(normalize('English: fluent; French - B1; Spanish')).map((l) => [l.name, l.good]),
    [
      ['inglese', true],
      ['francese', false],
      ['spagnolo', true],
    ],
  );
  assert.equal(findCity('Mario Rossi\nResidenza: Vicenza\nmario@example.com').name, 'Vicenza');
  assert.equal(findCity('Anna Bianchi | Abano Terme (PD) | 333 1234567').name, 'Abano Terme');
});

test('builder: proposte dalle aree scelte, senza escludere parole delle aree stesse', () => {
  const s = suggest(['editoria', 'sviluppo'], { years: 5, skills: ['indesign'] });
  assert.ok(s.keywords.includes('redattore') && s.keywords.includes('developer'));
  assert.ok(!s.exclude.includes('developer') && !s.exclude.includes('software'), "sviluppo è un'area scelta");
  assert.ok(s.exclude.includes('stage'), 'con 5 anni di esperienza niente stage');
  assert.ok(s.boost.includes('indesign'));
  assert.ok(!suggest(['editoria'], { years: 0 }).exclude.includes('stage'));
});

test('builder: il profilo generato è valido per la ricerca', () => {
  const s = suggest(['editoria']);
  const profile = buildProfile({
    name: 'Prova',
    ...s,
    languages: ['italiano', 'inglese'],
    places: ['Padova', 'Vicenza'],
    radiusKm: 35,
    remote: 'europa',
    browserSources: true,
  });
  assert.deepEqual(profile.enableSources, ['infojobs']);
  assert.ok(profile.languages.includes('english'));
  const resolved = resolveProfile(profile);
  assert.deepEqual(
    resolved.targets.map((t) => [t.type, t.label]),
    [
      ['area', 'Padova, Vicenza e dintorni'],
      ['remote', 'Full remote (Italia ed Europa)'],
    ],
  );
  assert.ok(resolved.targets[0].sources.some((s) => s.name === 'infojobs'));
  assert.throws(() => buildProfile({ name: 'x', ...s, places: [], remote: 'no' }), /almeno una zona/);
});

test('wizard: modifica delle liste e scelte numeriche', () => {
  assert.deepEqual(editList(['a', 'b'], ''), ['a', 'b']);
  assert.deepEqual(editList(['a', 'b'], '+c, -a'), ['b', 'c']);
  assert.deepEqual(editList(['a', 'b'], 'x, y'), ['x', 'y']);
  assert.deepEqual(editList(['a', 'b'], '-'), []);
  assert.deepEqual(parseChoices('2, 5 99', 10, [0]), [1, 4]);
  assert.deepEqual(parseChoices('', 10, [0]), [0]);
});

test('wizard: dal CV, accettando le proposte', async () => {
  await withProfilesDir(async () => {
    const io = scriptedIo(Array(15).fill(''));
    const { id, profile } = await runWizard(io, { cv: CV, now: NOW });
    assert.equal(id, 'editoria-e-redazione-padova');
    assert.equal(profile.candidate.years, 7);
    assert.deepEqual(
      profile.targets.map((t) => t.type),
      ['area', 'remote'],
    );
    assert.deepEqual(profile.targets[0].places, ['Padova']);
    assert.ok(profile.keywords.includes('redattrice') && profile.keywords.includes('peer review'));
    assert.ok(!profile.languages.includes('tedesco'), 'il tedesco A2 non basta');
    assert.ok(io.out.some((line) => /Laurea magistrale in linguistica/.test(line)));
  });
});

test('wizard: senza CV, con risposte e correzioni', async () => {
  await withProfilesDir(async () => {
    const io = scriptedIo([
      '', // niente CV
      '', // nessuna area: deve richiedere
      '3', // traduzione
      '0', // anni
      '', // parole chiave
      '+sottotitolatore', // affini
      '', // esclusioni
      '', // bonus
      '+inglese', // lingue
      'Atlantide', // comune sbagliato: lo richiede
      'Verona',
      '20',
      '1', // niente remoto
      '60',
      'n',
      'Traduttrice', // nome
      's',
    ]);
    const { id, profile } = await runWizard(io, {});
    assert.equal(id, 'traduttrice');
    assert.ok(io.out.some((l) => /Scegli almeno un'area/.test(l)));
    assert.ok(io.out.some((l) => /Comune non trovato: Atlantide/.test(l)));
    assert.deepEqual(
      profile.targets.map((t) => [t.type, t.places, t.radiusKm]),
      [['area', ['Verona'], 20]],
    );
    assert.ok(profile.relatedKeywords.includes('sottotitolatore'));
    assert.ok(!profile.excludeKeywords.includes('stage'), 'senza esperienza gli stage vanno bene');
    assert.deepEqual(profile.languages, ['italiano', 'italiana', 'italian', 'inglese', 'english']);
    assert.equal(profile.maxAgeDays, 60);
  });
});

test('wizard: nome già usato e annullamento', async () => {
  await withProfilesDir(async () => {
    await saveProfile('traduttrice', { name: 'vecchio', targets: [] });
    const answers = ['', '3', '0', '', '', '', '', '', 'Verona', '', '1', '', 'n', 'Traduttrice'];
    const io = scriptedIo([...answers, 's', 'n', 'Traduttrice Verona']);
    const result = await runWizard(io, {});
    assert.equal(result.id, 'traduttrice-verona');
    assert.equal(await runWizard(scriptedIo([...answers, 'n']), {}), null);
  });
});

test('archivio: salva, elenca e carica per nome', async () => {
  await withProfilesDir(async (dir) => {
    assert.deepEqual(await listProfiles(), []);
    await saveProfile('Redattrice Padova', { name: 'Redattrice Padova', targets: [{ type: 'remote' }] });
    await assert.rejects(saveProfile('redattrice-padova', {}), /Esiste già/);
    assert.equal(slugify('Città di Città!'), 'citta-di-citta');
    assert.equal(profilePath('redattrice-padova'), path.join(dir, 'redattrice-padova.json'));
    const [p] = await listProfiles();
    assert.equal(p.id, 'redattrice-padova');
    assert.equal((await loadProfile('redattrice-padova')).name, 'Redattrice Padova');
    assert.equal((await loadProfile('redattrice-padova.json')).name, 'Redattrice Padova');
    await assert.rejects(loadProfile('nessuno'), /non trovato. Profili disponibili: redattrice-padova/);
  });
});

test('il profilo incluso si carica anche per nome', async () => {
  const profile = await loadProfile('redattore-padova');
  assert.equal(profile.name, 'Editoria e redazione - Piazzola sul Brenta');
});

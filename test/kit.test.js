import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  analyzeOfferText,
  buildKit,
  buildKitPrompt,
  companyName,
  companySiteFromJob,
  cvContacts,
  findCompany,
  importKitAnswer,
  parseCv,
} from '../src/kit.js';
import { htmlToText } from '../src/text.js';
import { Tracking } from '../src/tracking.js';

const fixture = (name) => readFile(new URL(`./fixtures/kit/${name}`, import.meta.url), 'utf8');
const job = {
  id: 'job-1',
  title: 'Redattore junior',
  company: 'Edizioni Rosse S.r.l.',
  url: 'https://it.linkedin.com/jobs/view/1',
  source: 'linkedin',
};

test("annuncio: requisiti, mansioni, offerta e azienda dalle intestazioni; lingua dell'annuncio", async () => {
  const offer = analyzeOfferText(await fixture('offerta.txt'));
  assert.equal(offer.requirements.length, 6);
  assert.equal(offer.requirements[0], 'Laurea in materie umanistiche');
  assert.deepEqual(offer.tasks, [
    'Editing e revisione dei testi',
    'correzione di bozze',
    'rapporti con autori e illustratori',
    'coordinamento con la tipografia.',
  ]);
  assert.match(offer.company[0], /albi illustrati/);
  assert.equal(offer.language, 'it');

  // Annuncio in inglese, su una riga sola (come arriva da molti portali): si divide comunque.
  const en = analyzeOfferText(
    'About us We publish journals. Requirements: • 3+ years of experience as a copy editor • Fluent English • Knowledge of LaTeX',
  );
  assert.equal(en.language, 'en');
  assert.deepEqual(en.requirements, [
    '3+ years of experience as a copy editor',
    'Fluent English',
    'Knowledge of LaTeX',
  ]);
  // Senza intestazioni: le frasi che hanno l'aria di requisiti.
  assert.deepEqual(
    analyzeOfferText('Cerchiamo un redattore. È richiesta esperienza in redazione. Sede a Padova.').requirements,
    ['È richiesta esperienza in redazione'],
  );
});

test('gli elenchi degli annunci in HTML restano separati', () => {
  assert.equal(
    htmlToText('<p>Requisiti</p><ul><li>Laurea</li><li>Conoscenza di <b>InDesign</b></li></ul>'),
    'Requisiti\nLaurea\nConoscenza di InDesign',
  );
});

test('CV in parti: esperienze con i loro punti, righe spezzate dal PDF riunite; nome e contatti', async () => {
  const cvText = await fixture('cv.txt');
  const cv = parseCv(cvText);
  assert.equal(cv.header[0], 'Giulia Esempio');
  const experience = cv.sections.find((s) => s.kind === 'experience');
  assert.equal(experience.entries.length, 2);
  assert.deepEqual(experience.entries[0].points, [
    'Revisione e correzione di bozze di volumi e riviste scientifiche',
    'dialogo con autori e curatori',
    'coordinamento dei progetti editoriali',
    'impaginazione con Adobe InDesign.',
  ]);
  assert.deepEqual(cvContacts(cvText), {
    name: 'Giulia Esempio',
    email: 'giulia.esempio@example.com',
    phone: '+39 333 0000000',
  });
});

test('kit interno: requisiti coperti con le frasi del CV, lacune, CV fatto solo di righe del CV', async () => {
  const cvText = await fixture('cv.txt');
  const kit = buildKit({ job, text: await fixture('offerta.txt'), cvText });
  assert.deepEqual(kit.missing, ["Esperienza nella letteratura per l'infanzia"]);
  const indesign = kit.covered.find((r) => r.requirement === 'Ottima conoscenza di Adobe InDesign');
  assert.equal(indesign.highlight, 'impaginazione con Adobe InDesign.');
  const english = kit.covered.find((r) => /inglese/.test(r.requirement));
  assert.match(english.evidence[0], /Inglese: C1/);

  // Nessuna riga inventata: ogni riga del CV proposto (tolti titoli e trattini) è nel CV originale.
  const flat = cvText.replace(/\s+/g, ' ');
  for (const line of kit.cv.text.split('\n')) {
    const text = line.replace(/^- /, '').replace(/[.;]$/, '').trim();
    if (!text || /^[A-Z ]+$/.test(text)) continue;
    assert.ok(flat.includes(text), `riga non presa dal CV: ${text}`);
  }
  // Nell'esperienza più recente vengono prima i punti che rispondono all'annuncio.
  const lines = kit.cv.text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('03/2020'));
  assert.equal(lines[start + 4], '- dialogo con autori e curatori');

  // Email: frasi del CV, azienda senza forma societaria, portale con il nome giusto, firma dal CV.
  assert.equal(kit.email.subject, 'Candidatura per la posizione di Redattore junior – Giulia Esempio');
  assert.match(kit.email.body, /^Gentile team di Edizioni Rosse,/);
  assert.match(kit.email.body, /che ho visto su LinkedIn/);
  assert.match(kit.email.body, /- impaginazione con Adobe InDesign\n/);
  assert.match(kit.email.body, /Giulia Esempio\n\+39 333 0000000\ngiulia\.esempio@example\.com$/);
  assert.doesNotMatch(kit.email.body, /anni di esperienza/, 'gli anni sono una stima: non si scrivono');
  assert.match(kit.followUp.subject, /^Sollecito: candidatura per Redattore junior/);

  const prompt = buildKitPrompt(kit, cvText);
  assert.match(prompt, /Non inventare MAI nulla/);
  assert.match(prompt, /Requisiti che non trovo nel CV:\n- Esperienza nella letteratura per l'infanzia/);
  assert.match(prompt, /<annuncio>[\s\S]*Requisiti\n• Laurea/);
});

test('kit: anni chiesti più di quelli del CV → si segnala', () => {
  const cvText = 'Mario Rossi\nESPERIENZA\n2024 - oggi Redattore - Edizioni X\nRevisione di bozze in redazione.';
  const kit = buildKit({ job, text: 'Requisiti:\n- Almeno 5 anni di esperienza in redazione', cvText });
  assert.match(kit.covered[0].note, /l'annuncio ne chiede 5/);
});

test("azienda: nome senza forma societaria, sito dall'annuncio (non dai portali), elenco delle aziende", () => {
  assert.equal(companyName('Edizioni Rosse S.r.l.'), 'Edizioni Rosse');
  assert.equal(companyName('Wetlands'), 'Wetlands');
  assert.equal(companySiteFromJob(job), null);
  assert.equal(
    companySiteFromJob({ url: 'https://www.edizionirosse.it/lavora-con-noi/redattore' }),
    'https://www.edizionirosse.it/',
  );
  assert.equal(companySiteFromJob({ url: 'https://springernature.wd3.myworkdayjobs.com/x' }), null);
  const publishers = [
    { name: 'Edizioni Rosse', website: 'https://www.edizionirosse.it/', email: 'lavoro@edizionirosse.it' },
  ];
  assert.equal(findCompany(job, publishers).email, 'lavoro@edizionirosse.it');
  const kit = buildKit({ job, text: 'Requisiti: laurea', cvText: '', publishers });
  assert.equal(kit.email.to, 'lavoro@edizionirosse.it');
  assert.equal(kit.company.known, true);
});

test('risposta di Claude: si importa e si segnala quello che non è nel CV', async () => {
  const cvText = await fixture('cv.txt');
  const offerText = await fixture('offerta.txt');
  const kit = importKitAnswer(await fixture('risposta-claude.md'), { cvText, offerText });
  assert.match(kit.analysis, /albi illustrati/);
  assert.equal(kit.email.subject, 'Candidatura redattrice');
  assert.equal(kit.gaps.length, 1);
  assert.deepEqual(kit.questions, ['Quanti titoli hai seguito?']);
  const all = kit.warnings.join('\n');
  assert.match(all, /Numeri che non trovo.*120/);
  assert.match(all, /Lingue che non sono nel tuo CV: spagnolo/);
  assert.match(all, /Nomi di strumenti o sigle che non trovo nel CV: QuarkXPress/);
  assert.match(all, /giulia@altrodominio\.it/);
  assert.match(all, /«curatela di 40 albi illustrati per bambini» non sembra una frase del tuo CV/);
  assert.doesNotMatch(all, /impaginazione con Adobe InDesign» non sembra/);

  assert.throws(() => importKitAnswer('Ecco il CV: bla bla', { cvText }), /blocco ```json/);
});

test('solleciti: una settimana dopo l’invio, poi dieci giorni, poi basta; si fermano cambiando stato', () => {
  const tracking = new Tracking('/dev/null');
  const item = tracking.set(job, { status: 'candidatura', sentAt: '2026-09-01' }, '2026-09-01T10:00:00Z');
  assert.equal(item.sentAt, '2026-09-01');
  assert.equal(item.followUpAt, '2026-09-08');
  assert.deepEqual(tracking.due('2026-09-07T10:00:00Z'), []);
  assert.equal(tracking.due('2026-09-08T10:00:00Z').length, 1);

  tracking.followedUp(job.id, '2026-09-09T10:00:00Z');
  assert.equal(tracking.get(job.id).followUpAt, '2026-09-19');
  tracking.followedUp(job.id, '2026-09-20T10:00:00Z');
  assert.equal(tracking.get(job.id).followUpAt, null);
  assert.deepEqual(tracking.get(job.id).followUps, ['2026-09-09', '2026-09-20']);

  tracking.set(job, { status: 'nessuna' });
  assert.equal(tracking.get(job.id).followUpAt, null);
  assert.throws(() => tracking.followedUp(job.id), /candidature inviate/);
});

test('kit separati dalle candidature; quelle create solo aprendo un kit (versioni precedenti) si tolgono', async () => {
  const { KitStore, migrateKits } = await import('../src/kit-store.js');
  const kits = new KitStore('/dev/null');
  kits.save = async () => {};
  const tracking = new Tracking('/dev/null');
  tracking.save = async () => {};
  const at = '2026-09-29T10:00:00.000Z';
  // Creata aprendo il kit: nessun cambio di stato, nessuna nota.
  const auto = { ...job, id: 'auto', title: 'Auto' };
  tracking.set(auto, {}, at);
  tracking.items.auto.kit = { job: auto, language: 'it', createdAt: at };
  // Seguita davvero: stato cambiato dopo.
  const real = { ...job, id: 'real', title: 'Vera' };
  tracking.set(real, { status: 'interessante', note: 'mi piace' }, at);
  tracking.items.real.kit = { job: real, language: 'it', createdAt: at };

  assert.deepEqual(await migrateKits(tracking, kits), { moved: 2, removed: 1 });
  assert.equal(tracking.get('auto'), null);
  assert.equal(tracking.get('real').kit, undefined);
  assert.equal(tracking.get('real').note, 'mi piace');
  assert.deepEqual(kits.ids().sort(), ['auto', 'real']);
  assert.equal(kits.find(real.url).job.id, 'auto', 'stesso indirizzo di prova: vale il primo');
  assert.equal(kits.find('real').job.title, 'Vera');
  // Una seconda volta non cambia niente.
  assert.deepEqual(await migrateKits(tracking, kits), { moved: 0, removed: 0 });
});

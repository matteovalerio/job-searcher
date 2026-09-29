import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildInterviewPrep,
  buildInterviewPrompt,
  interviewIcs,
  likelyQuestions,
  questionsToAsk,
  thankYouEmail,
} from '../src/interview.js';
import { buildKit } from '../src/kit.js';
import { buildPlan, planMessage } from '../src/plan.js';
import { Tracking } from '../src/tracking.js';

const fixture = (name) => readFile(new URL(`./fixtures/kit/${name}`, import.meta.url), 'utf8');
const job = {
  id: 'job-1',
  title: 'Redattore junior',
  company: 'Edizioni Rosse S.r.l.',
  url: 'https://it.linkedin.com/jobs/view/1',
  source: 'linkedin',
};
const kitFor = async (extra = {}) =>
  buildKit({ job, text: await fixture('offerta.txt'), cvText: await fixture('cv.txt'), ...extra });

test('domande probabili: classiche, dai requisiti con le frasi del CV, dalle lacune, stipendio', async () => {
  const kit = await kitFor();
  const qs = likelyQuestions(kit, { salary: { min: 24000, max: 32000, median: 27000, count: 12 } });
  assert.equal(qs[0].question, 'Mi parli di lei.');
  assert.ok(qs[0].evidence.length > 0);
  assert.equal(qs[1].question, 'Perché proprio Edizioni Rosse?');

  // Ogni frase proposta come prova viene dal CV.
  const cv = (await fixture('cv.txt')).replace(/\s+/g, ' ');
  for (const q of qs) for (const e of q.evidence ?? []) assert.ok(cv.includes(e.replace(/\s+/g, ' ')), e);

  const gap = qs.find((q) => /infanzia/.test(q.question));
  assert.match(gap.hint, /Non dire di saperlo fare/);
  const money = qs.find((q) => /aspettative economiche/.test(q.question));
  assert.match(money.hint, /24k a 32k \(mediana 27k, su 12 annunci\)/);
  assert.equal(qs.at(-1).question, 'Ha domande per noi?');

  const noSalary = likelyQuestions(kit).find((q) => /aspettative economiche/.test(q.question));
  assert.match(noSalary.hint, /pagina Mercato/);
});

test("domande da fare: con gli strumenti citati nell'annuncio", async () => {
  const kit = await kitFor();
  const ask = questionsToAsk(kit);
  assert.ok(ask.some((q) => /InDesign/.test(q)));
  assert.ok(ask.some((q) => /prossimi passi/.test(q)));
});

test('email di ringraziamento: a chi ha fatto il colloquio, altrimenti al team', async () => {
  const kit = await kitFor();
  const team = thankYouEmail(kit, { contacts: { name: 'Giulia Bianchi' } });
  assert.equal(team.subject, 'Grazie per il colloquio – Redattore junior');
  assert.match(team.body, /^Gentile team di Edizioni Rosse,\n\nvi ringrazio/);
  assert.match(team.body, /Giulia Bianchi$/);

  const person = thankYouEmail(kit, { interviewer: 'Anna De Luca' });
  assert.match(person.body, /^Gentile Anna De Luca,\n\nla ringrazio .* mi ha dedicato/);

  const prep = buildInterviewPrep(kit, {
    interview: { at: '2026-10-05T13:00:00Z', with: 'Anna De Luca e Paolo Neri' },
  });
  assert.match(prep.thankYou.body, /^Gentile Anna De Luca,/);
  assert.ok(prep.stories.length > 0 && prep.company.toCheck.length > 0);
});

test('calendario: evento di un’ora con luogo e avviso un’ora prima', async () => {
  const kit = await kitFor();
  const ics = interviewIcs(
    kit,
    { at: '2026-10-05T13:00:00Z', where: 'Via Roma 1, Padova', with: 'Anna De Luca' },
    new Date('2026-09-29T08:00:00Z'),
  );
  assert.match(ics, /DTSTART:20261005T130000Z\r\nDTEND:20261005T140000Z/);
  assert.match(ics, /SUMMARY:Colloquio: Redattore junior – Edizioni Rosse/);
  assert.match(ics, /LOCATION:Via Roma 1\\, Padova/);
  assert.match(ics, /DESCRIPTION:Con: Anna De Luca\\nAnnuncio: /);
  assert.match(ics, /TRIGGER:-PT1H/);
  assert.throws(() => interviewIcs(kit, { at: 'domani' }), /non valida/);
});

test('testo per Claude: CV, annuncio, requisiti e regole contro le invenzioni', async () => {
  const kit = await kitFor();
  const prompt = buildInterviewPrompt(kit, 'CV DI PROVA', { interview: { with: 'Anna De Luca', mode: 'online' } });
  assert.match(prompt, /<cv>\nCV DI PROVA\n<\/cv>/);
  assert.match(prompt, /Il colloquio è con: Anna De Luca\.\nModalità: online\./);
  assert.match(prompt, /Requisiti che il CV non mostra:\n- Esperienza nella letteratura per l'infanzia/);
  assert.match(prompt, /Non inventare nulla su di me/);
  assert.match(prompt, /una domanda alla volta/);
});

test('candidature: segnare il colloquio porta allo stato colloquio e compare nel piano', () => {
  const t = new Tracking({});
  t.set(job, { status: 'candidatura' }, '2026-09-20T08:00:00Z');
  const item = t.setInterview(job, { at: '2026-10-05T13:00:00Z', mode: 'online' }, '2026-09-29T08:00:00Z');
  assert.equal(item.status, 'colloquio');
  assert.deepEqual(item.interview, { at: '2026-10-05T13:00:00Z', mode: 'online', where: null, with: null });
  assert.equal(t.upcomingInterviews('2026-09-29T08:00:00Z').length, 1);
  assert.equal(t.upcomingInterviews('2026-10-06T08:00:00Z').length, 0);
  assert.throws(() => t.setInterview(job, { at: 'boh' }), /non valida/);

  // Un'offerta ricevuta resta tale; togliere la data non cambia lo stato.
  t.set(job, { status: 'offerta' }, '2026-10-06T08:00:00Z');
  assert.equal(t.setInterview(job, null, '2026-10-06T09:00:00Z').status, 'offerta');
  assert.equal(t.items[job.id].interview, null);

  const t2 = new Tracking({});
  t2.setInterview(job, { at: '2026-10-05T13:00:00Z' }, '2026-09-29T08:00:00Z');
  const plan = buildPlan({ tracking: t2.list(), publishers: [], now: new Date('2026-09-30T10:00:00Z') });
  assert.deepEqual(
    plan.todo.interviews.map((i) => [i.id, i.at]),
    [['job-1', '2026-10-05T13:00:00Z']],
  );
  assert.match(
    planMessage(plan).text,
    /Colloqui in arrivo:\n- Redattore junior \(Edizioni Rosse S\.r\.l\.\): lun 5 ott.*15:00/,
  );
});

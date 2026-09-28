import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { makeJob } from '../src/job.js';
import { buildDigest, configuredChannels, notify, selectForDigest } from '../src/notify.js';
import { SeenStore } from '../src/store.js';

const job = (title, isNew = true, extra = {}) => ({
  ...makeJob('linkedin', {
    id: title,
    title,
    company: 'Piccin',
    location: 'Padova',
    url: `https://x/${encodeURIComponent(title)}`,
  }),
  title, // senza passare da makeJob, che converte l'HTML in testo: serve a provare l'escape
  isNew,
  ...extra,
});
const results = [
  {
    target: { label: 'Padova e dintorni' },
    jobs: [job('Redattrice'), job('Editor', false), job('Correttore di bozze')],
  },
  { target: { label: 'Full remote' }, jobs: [job('Copy editor', false)] },
];
const TELEGRAM = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };
const EMAIL = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u@example.com', SMTP_PASS: 'p', EMAIL_TO: 'me@example.com' };

test('digest: solo le offerte nuove, raggruppate per zona', () => {
  const d = selectForDigest(results);
  assert.equal(d.total, 2);
  assert.deepEqual(
    d.sections.map((s) => [s.label, s.jobs.map((j) => j.title)]),
    [['Padova e dintorni', ['Redattrice', 'Correttore di bozze']]],
  );
});

test('digest: alla prima esecuzione le migliori di ogni zona, non tutto', () => {
  const many = [{ target: { label: 'Zona' }, jobs: Array.from({ length: 30 }, (_, i) => job(`Editor ${i}`)) }];
  const d = selectForDigest(many, { firstRun: true });
  assert.equal(d.sections[0].jobs.length, 10);
  assert.equal(d.sections[0].more, 20);
  const msg = buildDigest(d, { profileName: 'Prova' });
  assert.match(msg.subject, /Ricerca attivata: 30 offerte/);
  assert.match(msg.text, /da domani ricevi solo quelle nuove/);
  assert.match(msg.text, /… e altre 20 nel report/);
});

test('messaggio: oggetto, testo, HTML con escape e Telegram diviso in parti', () => {
  const d = selectForDigest([{ target: { label: 'Zona <A>' }, jobs: [job('Editor & <script>', true)] }]);
  const msg = buildDigest(d, {
    profileName: 'Redattrice',
    reportUrl: 'https://github.com/r/actions/runs/1',
    date: new Date('2026-09-28'),
  });
  assert.equal(msg.subject, '1 nuova offerta per "Redattrice" (28/09/2026)');
  assert.match(msg.html, /Editor &amp; &lt;script&gt;/);
  assert.doesNotMatch(msg.html, /<script>/);
  assert.match(msg.telegram[0], /<b>Zona &lt;A&gt;<\/b>/);
  assert.match(msg.text, /Report completo: https:\/\/github.com\/r\/actions\/runs\/1/);

  const long = selectForDigest([
    { target: { label: 'Z' }, jobs: Array.from({ length: 25 }, (_, i) => job(`${'Editor '.repeat(30)}${i}`)) },
  ]);
  const parts = buildDigest(long, { profileName: 'P' }).telegram;
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 4096));
});

test('canali: si attivano solo con tutte le variabili necessarie', () => {
  assert.deepEqual(configuredChannels({}), []);
  assert.deepEqual(configuredChannels({ TELEGRAM_BOT_TOKEN: 't' }), []);
  assert.deepEqual(configuredChannels({ ...TELEGRAM, ...EMAIL }), ['telegram', 'email']);
});

test('invio: su ogni canale, un errore non blocca gli altri', async () => {
  const sent = [];
  const senders = {
    telegram: async (parts) => sent.push(['telegram', parts.length]),
    email: async () => {
      throw new Error('login fallito');
    },
  };
  const outcome = await notify(results, { profileName: 'P', env: { ...TELEGRAM, ...EMAIL }, senders });
  assert.deepEqual(outcome.sent, ['telegram']);
  assert.deepEqual(outcome.errors, ['email: login fallito']);
  assert.equal(outcome.total, 2);
  assert.deepEqual(sent, [['telegram', 1]]);

  assert.equal((await notify(results, { env: {} })).skipped, 'nessun canale configurato');
  const nothingNew = [{ target: { label: 'Z' }, jobs: [job('Editor', false)] }];
  assert.equal((await notify(nothingNew, { env: TELEGRAM, senders })).skipped, 'nessuna offerta nuova');
});

test('memoria: riconosce la prima esecuzione', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'seen-'));
  const store = await SeenStore.forProfile('Prova', dir).load();
  assert.equal(store.firstRun, true);
  store.mark([{ id: 'a' }]);
  await store.save();
  assert.equal((await SeenStore.forProfile('Prova', dir).load()).firstRun, false);
});

test('--no-browser esclude Indeed e InfoJobs', () => {
  const profile = {
    keywords: ['editor'],
    enableSources: ['indeed', 'infojobs'],
    targets: [{ type: 'area', place: 'Padova' }],
  };
  const names = (opts) => resolveProfile(profile, opts).targets[0].sources.map((s) => s.name);
  assert.ok(names().includes('indeed') && names().includes('infojobs'));
  assert.ok(!names({ noBrowser: true }).some((n) => n === 'indeed' || n === 'infojobs'));
  assert.ok(names({ noBrowser: true }).includes('linkedin'));
});

test('digest: la stessa offerta in due zone compare una volta sola', () => {
  const same = job('Redattrice');
  const d = selectForDigest([
    { target: { label: 'Padova' }, jobs: [same] },
    { target: { label: 'Remoto' }, jobs: [{ ...same }, job('Proofreader')] },
  ]);
  assert.equal(d.total, 2);
  assert.deepEqual(
    d.sections.map((s) => s.jobs.map((j) => j.title)),
    [['Redattrice'], ['Proofreader']],
  );
});

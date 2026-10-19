import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';
import { makeJob } from '../src/job.js';
import {
  buildDigest,
  configuredChannels,
  notify,
  parseByProfile,
  recipientsForProfile,
  selectForDigest,
  sendTelegram,
} from '../src/notify.js';
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

test('--no-browser esclude InfoJobs', () => {
  const profile = {
    keywords: ['editor'],
    enableSources: ['infojobs'],
    targets: [{ type: 'area', place: 'Padova' }],
  };
  const names = (opts) => resolveProfile(profile, opts).targets[0].sources.map((s) => s.name);
  assert.ok(names().includes('infojobs'));
  assert.ok(!names({ noBrowser: true }).includes('infojobs'));
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

test('più profili: chat Telegram ed email del profilo, altrimenti quelle generali', () => {
  assert.deepEqual(parseByProfile('{"redattore-padova": 123, "grafico": "-100456"}'), {
    'redattore-padova': '123',
    grafico: '-100456',
  });
  assert.deepEqual(parseByProfile('redattore-padova=123\ngrafico = -100456, altro=7'), {
    'redattore-padova': '123',
    grafico: '-100456',
    altro: '7',
  });
  assert.deepEqual(parseByProfile(''), {});
  assert.throws(() => parseByProfile('{rotto'), /non valido/);

  const env = {
    TELEGRAM_CHAT_ID: '1',
    EMAIL_TO: 'tutti@x.it',
    TELEGRAM_CHAT_ID_BY_PROFILE: 'grafico=-100456',
    EMAIL_TO_BY_PROFILE: '{"grafico": "anna@x.it"}',
  };
  assert.deepEqual(recipientsForProfile('grafico', env), { TELEGRAM_CHAT_ID: '-100456', EMAIL_TO: 'anna@x.it' });
  assert.deepEqual(recipientsForProfile('redattore-padova', env), {}, 'restano quelli generali');
  assert.deepEqual(recipientsForProfile('grafico', {}), {});
});

test('Telegram: riprova dopo un errore di rete o un 429, non dopo un chat id sbagliato', async (t) => {
  const env = { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '1' };
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  const reply = (status, body = {}) => new Response(JSON.stringify(body), { status });
  const offline = () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }));
  const answers = [];
  t.mock.method(globalThis, 'fetch', () => answers.shift()());

  // Rete giù una volta, poi troppi messaggi (Telegram dice di aspettare 7 secondi), poi va.
  answers.push(
    offline,
    () => reply(429, { parameters: { retry_after: 7 } }),
    () => reply(200, { ok: true }),
  );
  await sendTelegram(['ciao'], env, { wait });
  assert.deepEqual(waits, [3000, 7000]);

  // Sempre giù: dopo 4 tentativi si arrende, con la causa nel messaggio.
  waits.length = 0;
  answers.push(offline, offline, offline, offline);
  await assert.rejects(sendTelegram(['ciao'], env, { wait }), /fetch failed \(ECONNRESET\) \(dopo 4 tentativi\)/);
  assert.deepEqual(waits, [3000, 10000, 30000]);

  // Chat id sbagliato: inutile riprovare.
  waits.length = 0;
  answers.push(() => reply(400, { description: 'Bad Request: chat not found' }));
  await assert.rejects(sendTelegram(['ciao'], env, { wait }), /400: Bad Request: chat not found$/);
  assert.deepEqual(waits, []);
});

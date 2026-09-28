import { dedupeKey } from './dedupe.js';

/*
 * Notifiche delle offerte nuove, pensate per la ricerca quotidiana automatica (GitHub Actions o cron).
 * I canali si attivano con le variabili d'ambiente:
 *   Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   Email:    SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS, EMAIL_TO, EMAIL_FROM (default SMTP_USER)
 */

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

const TELEGRAM_LIMIT = 4000; // Telegram accetta messaggi fino a 4096 caratteri
const FIRST_RUN_TOP = 10;

export function configuredChannels(env = process.env) {
  const channels = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) channels.push('telegram');
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_TO) channels.push('email');
  return channels;
}

/**
 * Sceglie cosa notificare. Alla prima esecuzione tutte le offerte sono "nuove": invece di un elenco enorme
 * si mandano le migliori di ogni target, avvisando che da lì in poi arriveranno solo le nuove.
 * @returns {{ sections: { label: string, jobs: object[], more: number }[], total: number, firstRun: boolean }}
 */
export function selectForDigest(results, { firstRun = false, perTarget = 25 } = {}) {
  // La stessa offerta può uscire in più zone (es. un remoto con sede a Padova): la si elenca una volta sola.
  const listed = new Set();
  const sections = results
    .map(({ target, jobs }) => {
      const picked = (firstRun ? jobs : jobs.filter((j) => j.isNew)).filter((j) => {
        const key = dedupeKey(j);
        if (listed.has(key)) return false;
        listed.add(key);
        return true;
      });
      const limit = firstRun ? FIRST_RUN_TOP : perTarget;
      return {
        label: target.label,
        jobs: picked.slice(0, limit),
        more: Math.max(0, picked.length - limit),
        all: picked.length,
      };
    })
    .filter((s) => s.jobs.length);
  return { sections, total: sections.reduce((n, s) => n + s.all, 0), firstRun };
}

function jobLine(job) {
  return [job.company, job.location, job.source].filter(Boolean).join(' · ');
}

/** Testo del messaggio: oggetto, versione testuale, HTML (email) e messaggi Telegram (già divisi). */
export function buildDigest(digest, { profileName, reportUrl, date = new Date() } = {}) {
  const day =
    [date.getDate(), date.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('/') + `/${date.getFullYear()}`;
  const subject = digest.firstRun
    ? `Ricerca attivata: ${digest.total} offerte per "${profileName}"`
    : `${digest.total} ${digest.total === 1 ? 'nuova offerta' : 'nuove offerte'} per "${profileName}" (${day})`;
  const intro = digest.firstRun
    ? `Prima esecuzione: ho trovato ${digest.total} offerte. Qui sotto le migliori per ogni zona; da domani ricevi solo quelle nuove.`
    : '';

  const text = [
    subject,
    intro,
    ...digest.sections.flatMap((s) => [
      '',
      `== ${s.label} ==`,
      ...s.jobs.map((j) => `- ${j.title} (${jobLine(j)})\n  ${j.url}`),
      ...(s.more ? [`… e altre ${s.more} nel report`] : []),
    ]),
    ...(reportUrl ? ['', `Report completo: ${reportUrl}`] : []),
  ].join('\n');

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;max-width:640px">
<h2 style="font-size:18px">${esc(subject)}</h2>
${intro ? `<p>${esc(intro)}</p>` : ''}
${digest.sections
  .map(
    (s) => `<h3 style="font-size:16px;margin-top:20px">${esc(s.label)}</h3>
<ul style="padding-left:18px">${s.jobs
      .map(
        (j) =>
          `<li style="margin-bottom:8px"><a href="${esc(j.url)}">${esc(j.title)}</a><br><span style="color:#666">${esc(jobLine(j))}</span></li>`,
      )
      .join('')}</ul>${s.more ? `<p style="color:#666">… e altre ${s.more} nel report</p>` : ''}`,
  )
  .join('\n')}
${reportUrl ? `<p><a href="${esc(reportUrl)}">Report completo</a></p>` : ''}
</div>`;

  // Telegram: HTML semplice, diviso in più messaggi se troppo lungo.
  const lines = [
    `🔎 <b>${esc(subject)}</b>`,
    ...(intro ? [esc(intro)] : []),
    ...digest.sections.flatMap((s) => [
      '',
      `<b>${esc(s.label)}</b>`,
      ...s.jobs.map((j) => `• <a href="${esc(j.url)}">${esc(j.title)}</a>\n   ${esc(jobLine(j))}`),
      ...(s.more ? [`… e altre ${s.more} nel report`] : []),
    ]),
    ...(reportUrl ? ['', `<a href="${esc(reportUrl)}">Report completo</a>`] : []),
  ];
  const telegram = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > TELEGRAM_LIMIT) {
      telegram.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) telegram.push(current);

  return { subject, text, html, telegram };
}

export async function sendTelegram(messages, env = process.env) {
  for (const text of messages) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Telegram ha risposto ${res.status}: ${body.description ?? 'errore sconosciuto'}`);
    }
  }
}

export async function sendEmail({ subject, text, html }, env = process.env) {
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transport.sendMail({ from: env.EMAIL_FROM || env.SMTP_USER, to: env.EMAIL_TO, subject, text, html });
}

/**
 * Manda il riepilogo su tutti i canali configurati. Un canale che fallisce non blocca gli altri.
 * @returns {Promise<{ sent: string[], errors: string[], skipped?: string }>}
 */
export async function notify(results, { profileName, firstRun, reportUrl, env = process.env, senders = {} } = {}) {
  const channels = configuredChannels(env);
  if (!channels.length) return { sent: [], errors: [], skipped: 'nessun canale configurato' };
  const digest = selectForDigest(results, { firstRun });
  if (!digest.total) return { sent: [], errors: [], skipped: 'nessuna offerta nuova' };
  const message = buildDigest(digest, { profileName, reportUrl });
  const send = { telegram: sendTelegram, email: sendEmail, ...senders };
  const sent = [];
  const errors = [];
  for (const channel of channels) {
    try {
      await send[channel](channel === 'telegram' ? message.telegram : message, env);
      sent.push(channel);
    } catch (err) {
      errors.push(`${channel}: ${err.message}`);
    }
  }
  return { sent, errors, total: digest.total };
}

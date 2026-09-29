import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomic.js';
import { escapeHtml } from './notify.js';
import { stateDir } from './paths.js';
import { PUBLISHER_KINDS } from './publishers/specialties.js';
import { needsFollowUp } from './publishers/store.js';

/*
 * Piano settimanale e statistiche delle candidature.
 *   - obiettivi della settimana (candidature a offerte, candidature spontanee) e a che punto sei;
 *   - cosa fare: solleciti in scadenza, offerte segnate "interessante" e aziende "da contattare";
 *   - come sta andando: tasso di risposta e colloqui per canale (LinkedIn, InfoJobs, spontanee…) e per settore,
 *     tempo medio di risposta, andamento delle ultime settimane.
 * Tutto si ricava dai dati che il programma salva già (candidature e aziende); gli obiettivi stanno in
 * .job-searcher/plan.json.
 */

export const DEFAULT_GOALS = { applications: 5, spontaneous: 3 };

const planFile = () => stateDir('plan.json');

export async function loadPlan(file = planFile()) {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return { goals: { ...DEFAULT_GOALS, ...saved.goals } };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { goals: { ...DEFAULT_GOALS } };
  }
}

export async function savePlan(plan, file = planFile()) {
  const goals = {};
  for (const key of Object.keys(DEFAULT_GOALS)) {
    const n = Number(plan.goals?.[key]);
    if (!Number.isInteger(n) || n < 0 || n > 100)
      throw new Error(`Obiettivo "${key}" non valido: serve un numero da 0 a 100`);
    goals[key] = n;
  }
  await writeFileAtomic(file, `${JSON.stringify({ goals }, null, 2)}\n`);
  return { goals };
}

/* Date: giorni "AAAA-MM-GG" nel fuso italiano; la settimana va da lunedì a domenica. */

const TZ = 'Europe/Rome';
export const dayOf = (date) => new Date(date).toLocaleDateString('sv-SE', { timeZone: TZ });
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Lunedì della settimana di un giorno. */
export function weekStart(day) {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // lunedì = 0
  return addDays(day, -weekday);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// biome-ignore format: tabella
const SOURCE_LABELS = { linkedin: 'LinkedIn', infojobs: 'InfoJobs', jooble: 'Jooble', adzuna: 'Adzuna', remotive: 'Remotive', remoteok: 'Remote OK', himalayas: 'Himalayas', jobicy: 'Jobicy', inpa: 'inPA', weworkremotely: 'We Work Remotely' };
const RESPONSE = ['colloquio', 'offerta', 'rifiutata'];
const INTERVIEW = ['colloquio', 'offerta'];

/**
 * Le candidature inviate, da offerte e spontanee, in una forma sola:
 * { kind: 'offerta'|'spontanea', id, title, company, channel, sector, sentAt, followUps, response, interview, status }
 */
export function applications(trackingItems = [], publisherItems = []) {
  const out = [];
  for (const t of trackingItems) {
    const history = [...(t.history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    const sentEntry = history.find((h) => h.status === 'candidatura');
    if (!t.sentAt && !sentEntry) continue;
    const sentAt = t.sentAt ?? dayOf(sentEntry.at);
    const after = history.filter((h) => dayOf(h.at) >= sentAt);
    const response = after.find((h) => RESPONSE.includes(h.status));
    out.push({
      kind: 'offerta',
      id: t.job.id,
      title: t.job.title,
      company: t.job.company ?? null,
      channel: SOURCE_LABELS[t.job.source] ?? t.job.source ?? 'altro',
      sector: null,
      sentAt,
      followUps: t.followUps ?? [],
      response: response ? { at: dayOf(response.at), positive: response.status !== 'rifiutata' } : null,
      interview: after.some((h) => INTERVIEW.includes(h.status)),
      status: t.status,
    });
  }
  for (const p of publisherItems) {
    const history = [...(p.history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    const sentEntry = history.find((h) => h.status === 'inviata');
    if (!p.sentAt && !sentEntry) continue;
    const sentAt = p.sentAt ?? dayOf(sentEntry.at);
    const after = history.filter((h) => dayOf(h.at) >= sentAt);
    const response = after.find((h) => ['colloquio', 'rifiutata'].includes(h.status));
    out.push({
      kind: 'spontanea',
      id: p.id,
      title: p.name,
      company: p.name,
      channel: 'Candidatura spontanea',
      sector: PUBLISHER_KINDS[p.kind] ?? 'altro',
      sentAt,
      followUps: after.filter((h) => h.status === 'sollecitata').map((h) => dayOf(h.at)),
      response: response ? { at: dayOf(response.at), positive: response.status === 'colloquio' } : null,
      interview: after.some((h) => h.status === 'colloquio'),
      status: p.status,
    });
  }
  return out.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Numeri di un gruppo di candidature. */
function summary(list, today) {
  const responses = list.filter((a) => a.response);
  // Le candidature di meno di una settimana non contano nel tasso: è presto per una risposta.
  const mature = list.filter((a) => daysBetween(a.sentAt, today) >= 7 || a.response);
  return {
    sent: list.length,
    responses: responses.length,
    interviews: list.filter((a) => a.interview).length,
    waiting: list.filter((a) => !a.response && !['nessuna', 'nessuna_risposta'].includes(a.status)).length,
    responseRate: mature.length ? responses.filter((a) => mature.includes(a)).length / mature.length : null,
    interviewRate: mature.length ? mature.filter((a) => a.interview).length / mature.length : null,
    medianDays: median(responses.map((a) => daysBetween(a.sentAt, a.response.at))),
  };
}

function groupBy(list, key, today) {
  const groups = new Map();
  for (const a of list) {
    const k = a[key];
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, ...summary(items, today) }))
    .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
}

/**
 * Il piano: settimana in corso, cose da fare e statistiche.
 * @param {{ tracking: object[], publishers: object[], goals?: object, now?: Date|string }} data
 */
export function buildPlan({ tracking = [], publishers = [], goals = DEFAULT_GOALS, now = new Date() }) {
  const today = dayOf(now);
  const start = weekStart(today);
  const end = addDays(start, 6);
  const all = applications(tracking, publishers);
  const inWeek = (day) => day >= start && day <= end;

  const week = {
    start,
    end,
    applications: {
      done: all.filter((a) => a.kind === 'offerta' && inWeek(a.sentAt)).length,
      goal: goals.applications,
    },
    spontaneous: {
      done: all.filter((a) => a.kind === 'spontanea' && inWeek(a.sentAt)).length,
      goal: goals.spontaneous,
    },
    followUps: { done: all.flatMap((a) => a.followUps).filter(inWeek).length },
  };

  // Da fare: prima i solleciti scaduti, poi le offerte interessanti e le aziende da contattare.
  const dueJobs = tracking
    .filter((t) => t.status === 'candidatura' && t.followUpAt && t.followUpAt <= today)
    .map((t) => ({
      kind: 'offerta',
      id: t.job.id,
      title: t.job.title,
      company: t.job.company,
      sentAt: t.sentAt,
      dueAt: t.followUpAt,
    }));
  const duePublishers = publishers
    .filter((p) => needsFollowUp(p, today))
    .map((p) => ({
      kind: 'spontanea',
      id: p.id,
      title: p.name,
      company: p.name,
      sentAt: p.sentAt,
      dueAt: p.followUpAt,
    }));
  const todo = {
    followUps: [...dueJobs, ...duePublishers].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    toApply: tracking
      .filter((t) => t.status === 'interessante')
      .sort((a, b) => (b.job.score ?? 0) - (a.job.score ?? 0) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((t) => ({ id: t.job.id, title: t.job.title, company: t.job.company, url: t.job.url })),
    toContact: publishers
      .filter((p) => p.status === 'da_contattare')
      .slice(0, 8)
      .map((p) => ({ id: p.id, title: p.name, sector: PUBLISHER_KINDS[p.kind] ?? null, email: p.email ?? null })),
  };

  // Ultime 8 settimane, dalla più vecchia.
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const s = addDays(start, -7 * (7 - i));
    const e = addDays(s, 6);
    const sent = all.filter((a) => a.sentAt >= s && a.sentAt <= e);
    return {
      start: s,
      applications: sent.filter((a) => a.kind === 'offerta').length,
      spontaneous: sent.filter((a) => a.kind === 'spontanea').length,
    };
  });

  return {
    today,
    goals,
    week,
    todo,
    stats: {
      overall: summary(all, today),
      byChannel: groupBy(all, 'channel', today),
      bySector: groupBy(
        all.filter((a) => a.kind === 'spontanea'),
        'sector',
        today,
      ),
      weeks,
    },
    advice: advise(week, all, today),
  };
}

/** Due o tre frasi su cosa conviene fare, dai numeri. */
function advise(week, all, today) {
  const out = [];
  const missing = (w) => Math.max(0, w.goal - w.done);
  const left = missing(week.applications) + missing(week.spontaneous);
  if (left) {
    const parts = [
      missing(week.applications) &&
        `${missing(week.applications)} ${missing(week.applications) === 1 ? 'candidatura' : 'candidature'} a offerte`,
      missing(week.spontaneous) &&
        `${missing(week.spontaneous)} ${missing(week.spontaneous) === 1 ? 'spontanea' : 'spontanee'}`,
    ].filter(Boolean);
    out.push(`Per l'obiettivo della settimana mancano ${parts.join(' e ')}.`);
  } else if (week.applications.goal + week.spontaneous.goal > 0) {
    out.push('Obiettivo della settimana raggiunto.');
  }
  // Il canale che risponde di più, se ci sono abbastanza candidature per dirlo.
  const channels = groupBy(all, 'channel', today).filter((c) => c.sent >= 3 && c.responseRate !== null);
  if (channels.length >= 2) {
    const best = [...channels].sort((a, b) => b.responseRate - a.responseRate)[0];
    if (best.responseRate > 0) {
      out.push(
        `Finora risponde di più «${best.name}» (${Math.round(best.responseRate * 100)}% di risposte): conviene insistere lì.`,
      );
    }
  }
  if (all.length && all.length < 5)
    out.push('Con poche candidature i numeri dicono ancora poco: contano dalla decina in su.');
  return out;
}

/** Messaggio breve per Telegram o email: la settimana e i solleciti. */
export function planMessage(plan) {
  const w = plan.week;
  const lines = [
    `Piano della settimana (${w.start.slice(8)}/${w.start.slice(5, 7)} - ${w.end.slice(8)}/${w.end.slice(5, 7)})`,
    `Candidature a offerte: ${w.applications.done}/${w.applications.goal}`,
    `Candidature spontanee: ${w.spontaneous.done}/${w.spontaneous.goal}`,
    `Solleciti fatti: ${w.followUps.done}`,
  ];
  if (plan.todo.followUps.length) {
    lines.push('', 'Da sollecitare:');
    for (const f of plan.todo.followUps)
      lines.push(`- ${f.title}${f.company && f.company !== f.title ? ` (${f.company})` : ''}`);
  }
  lines.push(...(plan.advice.length ? ['', ...plan.advice] : []));
  const text = lines.join('\n');
  // Telegram usa l'HTML: i titoli vanno protetti ("R&D", "<b>").
  return { subject: 'job-searcher: piano della settimana', text, telegram: [escapeHtml(text)] };
}

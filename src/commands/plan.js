import { loadTrackingAndKits } from '../kit-store.js';
import { sendMessage } from '../notify.js';
import { c } from '../output/terminal.js';
import { buildPlan, loadPlan, planMessage, savePlan } from '../plan.js';
import { Publishers } from '../publishers/store.js';

export const PLAN_HELP = `
Piano settimanale e statistiche:
  job-searcher piano [--notify]              la settimana, cosa fare e come sta andando (--notify: anche su
                                             Telegram o per email)
  job-searcher piano obiettivi <offerte> <spontanee>   candidature a settimana (predefiniti: 5 e 3)
`;

const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const pct = (x) => (x === null ? 'n.d.' : `${Math.round(x * 100)}%`);
const bar = (done, goal) => {
  const width = 10;
  const full = goal ? Math.min(width, Math.round((done / goal) * width)) : 0;
  return `${c.green('█'.repeat(full))}${c.dim('░'.repeat(width - full))}`;
};

export async function planCommand(opts) {
  const [action, ...values] = opts.args;
  if (action === 'obiettivi') {
    const [applications, spontaneous] = values;
    const plan = await savePlan({ goals: { applications, spontaneous } });
    return console.log(
      `${c.green('✓')} Obiettivi: ${plan.goals.applications} candidature a offerte e ${plan.goals.spontaneous} spontanee a settimana.`,
    );
  }
  const [{ tracking }, publishers, { goals }] = await Promise.all([
    loadTrackingAndKits(),
    new Publishers().load(),
    loadPlan(),
  ]);
  const plan = buildPlan({ tracking: Object.values(tracking.items), publishers: publishers.items, goals });
  const w = plan.week;

  console.log(c.bold(`Settimana dal ${w.start} al ${w.end}`));
  console.log(
    `  Candidature a offerte  ${bar(w.applications.done, w.applications.goal)} ${w.applications.done}/${w.applications.goal}`,
  );
  console.log(
    `  Candidature spontanee  ${bar(w.spontaneous.done, w.spontaneous.goal)} ${w.spontaneous.done}/${w.spontaneous.goal}`,
  );
  console.log(`  Solleciti fatti        ${w.followUps.done}`);
  for (const a of plan.advice) console.log(`  ${c.yellow('→')} ${a}`);

  const { followUps, toApply, toContact } = plan.todo;
  if (followUps.length || toApply.length || toContact.length) console.log(`\n${c.bold('Da fare')}`);
  if (followUps.length) {
    console.log(c.cyan('  Da sollecitare'));
    for (const f of followUps)
      console.log(
        `    ${f.title}${f.company && f.company !== f.title ? c.dim(` · ${f.company}`) : ''}  ${c.dim(`inviata il ${f.sentAt}`)}`,
      );
  }
  if (toApply.length) {
    console.log(c.cyan('  Offerte interessanti a cui candidarsi'));
    for (const t of toApply) console.log(`    ${t.title}${t.company ? c.dim(` · ${t.company}`) : ''}`);
  }
  if (toContact.length) {
    console.log(c.cyan('  Aziende da contattare'));
    for (const t of toContact) console.log(`    ${t.title}${t.sector ? c.dim(` · ${t.sector}`) : ''}`);
  }

  const s = plan.stats;
  console.log(`\n${c.bold('Come sta andando')}`);
  if (!s.overall.sent) {
    console.log(c.dim('  Nessuna candidatura inviata finora: i numeri compaiono dopo le prime.'));
  } else {
    const o = s.overall;
    console.log(
      `  ${n(o.sent, 'inviata', 'inviate')} · ${n(o.responses, 'risposta', 'risposte')} (${pct(o.responseRate)}) · ${n(o.interviews, 'colloquio', 'colloqui')} (${pct(o.interviewRate)}) · ${o.waiting} in attesa${o.medianDays !== null ? ` · risposta in ${n(o.medianDays, 'giorno', 'giorni')} (mediana)` : ''}`,
    );
    const table = (title, rows) => {
      if (!rows.length) return;
      console.log(c.cyan(`  ${title}`));
      for (const r of rows) {
        console.log(
          `    ${r.name.padEnd(24)} ${String(r.sent).padStart(3)} inviate  ${pct(r.responseRate).padStart(4)} risposte  ${pct(r.interviewRate).padStart(4)} colloqui`,
        );
      }
    };
    table('Per canale', s.byChannel);
    table('Candidature spontanee per settore', s.bySector);
    console.log(c.dim('  Nei tassi contano le candidature di almeno una settimana.'));
  }

  if (opts.notify) {
    const result = await sendMessage(planMessage(plan));
    if (result.skipped) console.error(c.yellow(`! Notifica non mandata: ${result.skipped}`));
    for (const e of result.errors) console.error(c.red(`! ${e}`));
    if (result.sent.length) console.error(c.dim(`Mandato su: ${result.sent.join(', ')}`));
  }
}

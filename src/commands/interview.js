import { writeFile } from 'node:fs/promises';
import { buildInterviewPrep, buildInterviewPrompt, interviewIcs } from '../interview.js';
import { cvContacts } from '../kit.js';
import { loadTrackingAndKits } from '../kit-store.js';
import { analyzeMarket, loadHistory } from '../market/index.js';
import { c } from '../output/terminal.js';
import { loadCvText } from '../tailor.js';
import { profileOfJob } from '../tracking.js';

export const INTERVIEW_HELP = `
Colloqui (serve il kit dell'offerta: job-searcher kit <codice>):
  job-searcher colloquio <codice> [--date "2026-10-05 15:00"] [--note "online, con Anna De Luca"]
                                              preparazione: domande probabili, azienda, domande da fare,
                                              ringraziamento; --date segna il colloquio (stato "colloquio")
  job-searcher colloquio <codice> --prompt [-o file]   testo per claude.ai: simulazione del colloquio
  job-searcher colloquio <codice> calendario [-o file.ics]   il colloquio nel calendario
`;

export async function interviewCommand(opts) {
  const [ref, action] = opts.args;
  if (!ref) return console.log(INTERVIEW_HELP);
  const { tracking, kits } = await loadTrackingAndKits();
  const kit = kits.find(ref);
  if (!kit) throw new Error(`Prepara prima il kit: job-searcher kit ${ref}`);
  if (opts.date) {
    const at = new Date(opts.date.replace(' ', 'T'));
    if (Number.isNaN(at.getTime())) throw new Error('--date va scritta come "2026-10-05 15:00"');
    tracking.setInterview(kit.job, { at: at.toISOString(), with: opts.note ?? null });
    await tracking.save();
    console.error(c.green(`✓ Colloquio segnato: ${at.toLocaleString('it-IT')}`));
  }
  const item = tracking.get(kit.job.id);
  const cvText = (await loadCvText()) ?? '';
  const out = async (text) => {
    if (opts.out) {
      await writeFile(opts.out, text);
      return console.error(`Salvato in ${opts.out}.`);
    }
    console.log(text);
  };
  if (action === 'calendario') {
    if (!item?.interview?.at) throw new Error('Segna prima la data: --date "2026-10-05 15:00"');
    return out(interviewIcs(kit, item.interview));
  }
  if (opts.prompt) return out(buildInterviewPrompt(kit, cvText, { interview: item?.interview }));

  const profileId = await profileOfJob(kit.job.id);
  const salary = profileId ? analyzeMarket(Object.values((await loadHistory(profileId)).jobs)).salary : null;
  const prep = buildInterviewPrep(kit, { salary, contacts: cvContacts(cvText), interview: item?.interview });
  const rule = (t) => console.log(`\n${c.bold(c.cyan(`── ${t} `.padEnd(60, '─')))}`);
  console.log(c.bold(`${kit.job.title}${kit.job.company ? ` · ${kit.job.company}` : ''}`));
  if (item?.interview?.at)
    console.log(
      `Colloquio: ${new Date(item.interview.at).toLocaleString('it-IT')}${item.interview.with ? ` con ${item.interview.with}` : ''}`,
    );
  rule('Domande probabili');
  for (const q of prep.questions) {
    console.log(`  ${c.bold(q.question)}`);
    console.log(c.dim(`    ${q.hint}`));
    if (q.evidence?.length) console.log(c.dim(`    dal CV: «${q.evidence.join('» / «')}»`));
  }
  if (prep.stories.length) {
    rule('Episodi da preparare');
    for (const st of prep.stories) console.log(`  - ${st}`);
  }
  rule('L’azienda');
  for (const k of prep.company.known) console.log(`  ${k}`);
  for (const k of prep.company.toCheck) console.log(c.dim(`  da controllare: ${k}`));
  rule('Domande da fare');
  for (const k of prep.ask) console.log(`  - ${k}`);
  rule('Ringraziamento (entro un giorno)');
  console.log(`${c.dim('Oggetto:')} ${prep.thankYou.subject}\n\n${prep.thankYou.body}`);
  console.log(c.dim('\nSimulazione con Claude: job-searcher colloquio <codice> --prompt'));
}

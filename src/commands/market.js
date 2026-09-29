import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeMarket, buildMarketPrompt, jobFeatures, loadHistory } from '../market/index.js';
import { c } from '../output/terminal.js';
import { readCvText } from '../profiles/cv.js';
import { loadProfile, slugify } from '../profiles/store.js';
import { loadCvText } from '../tailor.js';
import { loadLastResults } from '../tracking.js';

export const MARKET_HELP = `
Analisi del mercato:
  job-searcher market -p profilo [--cv file.pdf] [--prompt] [-o file]
                                            cosa chiedono gli annunci trovati (competenze, lingue, esperienza,
                                            contratti, stipendi), confronto con il CV e piano per le lacune;
                                            con --prompt il testo per farsi fare da Claude un piano personale
`;

/** Offerte da analizzare: lo storico del profilo, altrimenti gli ultimi risultati. */
export async function marketFeatures(profileId) {
  const history = await loadHistory(profileId);
  const fromHistory = Object.values(history.jobs);
  if (fromHistory.length) return fromHistory;
  const last = await loadLastResults(profileId);
  return last ? last.targets.flatMap((t) => t.jobs).map(jobFeatures) : [];
}

const bar = (share, width = 20) => {
  const n = Math.round(share * width);
  return `${'█'.repeat(n)}${'░'.repeat(width - n)}`;
};
const pct = (share) => `${String(Math.round(share * 100)).padStart(3)}%`;

export async function marketCommand(opts) {
  if (!opts.profile) throw new Error('Indica il profilo: job-searcher market -p <nome>');
  const profile = await loadProfile(opts.profile);
  const profileId = slugify(path.basename(opts.profile, '.json'));
  const features = await marketFeatures(profileId);
  if (!features.length)
    throw new Error(`Nessuna offerta da analizzare: lancia prima "job-searcher search -p ${opts.profile}".`);
  const cvText = opts.cv ? await readCvText(opts.cv) : ((await loadCvText()) ?? '');
  const analysis = analyzeMarket(features, cvText);

  if (opts.prompt) {
    const prompt = buildMarketPrompt({ analysis, cvText, profileName: profile.name });
    if (opts.out) {
      await writeFile(opts.out, prompt);
      console.log(c.green(`Testo salvato in ${opts.out}. Incollalo in una nuova chat su claude.ai.`));
    } else {
      console.log(prompt);
    }
    return;
  }

  console.log(c.bold(`Analisi del mercato — ${profile.name ?? opts.profile}`));
  console.log(
    c.dim(
      `${analysis.total} annunci con la descrizione${analysis.withoutDescription ? ` (e ${analysis.withoutDescription} senza, non contati)` : ''}; ${cvText ? 'confronto con il CV salvato' : 'nessun CV: salvalo con "cv set" per vedere le lacune'}`,
    ),
  );
  if (!analysis.total) return;

  console.log(`\n${c.bold('Cosa chiedono gli annunci')}`);
  for (const s of analysis.skills.slice(0, 15)) {
    const mark = !cvText ? ' ' : s.inCv ? c.green('✓') : c.yellow('✗');
    console.log(`  ${mark} ${bar(s.share)} ${pct(s.share)}  ${s.label}`);
  }
  if (analysis.languages.length) {
    console.log(`\n${c.bold('Lingue')}`);
    for (const l of analysis.languages) {
      console.log(
        `    ${bar(l.share)} ${pct(l.share)}  ${l.name}${l.typical ? ` (di solito ${l.typical})` : ''}${cvText ? c.dim(` · nel CV: ${l.cvLevel ?? 'no'}`) : ''}`,
      );
    }
  }
  const e = analysis.experience;
  console.log(`\n${c.bold('Esperienza e contratti')}`);
  if (e.count) {
    console.log(
      `    anni richiesti: mediana ${e.median} (${e.buckets.map((b) => `${b.label} ${b.count}`).join(', ')})${e.cvYears != null ? ` · tu: circa ${e.cvYears}` : ''}`,
    );
  }
  if (analysis.contracts.length)
    console.log(`    contratti: ${analysis.contracts.map((x) => `${x.value} ${x.count}`).join(', ')}`);
  if (analysis.salary) {
    const k = (n) => `${Math.round(n / 1000)}k`;
    console.log(
      `    stipendi (annui lordi, ${analysis.salary.count} annunci): da ${k(analysis.salary.min)} a ${k(analysis.salary.max)} €, mediana ${k(analysis.salary.median)} €`,
    );
  }

  if (!cvText) return;
  const gaps = [...analysis.gaps, ...analysis.languageGaps];
  console.log(
    `\n${c.bold('Punti di forza')}: ${
      analysis.strengths
        .slice(0, 8)
        .map((s) => s.label)
        .join(', ') || 'nessuno tra quelli richiesti'
    }`,
  );
  if (!gaps.length) {
    console.log(c.green('\nNessuna lacuna evidente rispetto agli annunci trovati.'));
    return;
  }
  console.log(`\n${c.bold('Come colmare le lacune')} ${c.dim('(priorità in base a quanto spesso sono richieste)')}`);
  for (const g of analysis.gaps) {
    console.log(`\n  ${c.yellow(g.label)} — ${pct(g.share).trim()} degli annunci, priorità ${g.priority}`);
    for (const l of g.learn) console.log(`    • ${l}`);
    console.log(c.dim(`    nel CV: ${g.show}`));
  }
  for (const l of analysis.languageGaps) {
    console.log(
      `\n  ${c.yellow(`${l.name} ${l.typical ?? ''}`.trim())} — ${pct(l.share).trim()} degli annunci, nel CV: ${l.cvLevel ?? 'non indicata'}, priorità ${l.priority}`,
    );
    console.log(`    • ${l.learn}`);
  }
  console.log(
    `\nPer un piano personale settimana per settimana: ${c.bold(`job-searcher market -p ${opts.profile} --prompt`)}`,
  );
}

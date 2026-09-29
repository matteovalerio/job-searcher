import { resolveProfile } from '../config.js';
import { diagnoseLinkedin } from '../diagnose.js';
import { c } from '../output/terminal.js';
import { loadProfile } from '../profiles/store.js';

export const WHY_HELP = `
Perché un'offerta non compare:
  job-searcher perche <link di LinkedIn> -p <profilo>   dice se le ricerche del profilo la trovano, se il filtro
                                                        la scarta e perché, e cosa cambiare nel profilo
`;

/** Stampa la diagnosi di un'offerta di LinkedIn (vedi diagnose.js). */
export async function whyCommand(opts) {
  const [ref] = opts.args;
  if (!ref || !opts.profile) throw new Error('Uso: job-searcher perche <link di LinkedIn> -p <profilo>');
  const profile = resolveProfile(await loadProfile(opts.profile), { onlySources: ['linkedin'] });
  console.error(c.dim('Scarico l’offerta e provo le ricerche del profilo su LinkedIn (qualche decina di secondi)…'));
  const { job, targets } = await diagnoseLinkedin(ref, profile);
  console.log(`\n${c.bold(job.title || '(titolo non trovato)')}`);
  console.log(
    `${[job.company, job.location].filter(Boolean).join(' · ')}${job.postedAt ? c.dim(`  pubblicata verso il ${job.postedAt.slice(0, 10)}`) : ''}`,
  );
  for (const t of targets) {
    console.log(`\n${c.bold(c.cyan(t.target.label ?? t.target.id))}`);
    const v = t.verdict;
    if (v.rejected) {
      console.log(`  ${c.red('✗')} Il filtro la scarta: ${v.rejected}`);
    } else {
      console.log(`  ${c.green('✓')} Il filtro la tiene (punteggio ${v.score}: ${v.matched.join(', ')})`);
    }
    if (v.details.place) {
      const p = v.details.place;
      console.log(
        c.dim(
          `    località «${job.location}»: ${p.ok ? 'in zona' : p.reason}${p.distanceKm != null ? `, ${p.distanceKm} km` : ''}`,
        ),
      );
    }
    const s = t.search;
    if (s.skipped) console.log(`  ${c.yellow('-')} ${s.skipped}`);
    else if (s.found) {
      console.log(
        `  ${c.green('✓')} La ricerca «${s.found.keyword}» a «${s.found.location}» la trova (pagina ${s.found.page}, posizione ${s.found.position})`,
      );
    } else {
      const what =
        s.tried.length === 1 ? "L'unica ricerca del profilo" : `Nessuna delle ${s.tried.length} ricerche del profilo`;
      console.log(`  ${c.red('✗')} ${what} non la trova (fino a ${s.pagesChecked} pagine):`);
      for (const q of s.tried) console.log(c.dim(`    «${q.keyword}» a «${q.location}»: ${q.count} offerte`));
      if (s.byTitle) {
        console.log(
          `    cercando il titolo «${s.byTitle.keyword}»: ${s.byTitle.found ? c.green('trovata') : c.red('non trovata')}`,
        );
      }
    }
    for (const a of t.advice) console.log(`  ${c.yellow('→')} ${a}`);
    if (!v.rejected && s.found && !s.beyondNormalPages) {
      console.log(
        c.dim('  Dovrebbe comparire: se non la vedi, rilancia la ricerca (LinkedIn cambia spesso i risultati).'),
      );
    }
  }
}

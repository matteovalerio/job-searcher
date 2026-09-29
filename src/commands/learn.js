import path from 'node:path';
import { applySuggestion, dismissSuggestion, learnForProfile } from '../learn.js';
import { c } from '../output/terminal.js';
import { listProfiles, saveProfile, slugify } from '../profiles/store.js';

export const LEARN_HELP = `
Il profilo che impara dalle tue scelte (offerte segnate «non mi interessa» e offerte seguite):
  job-searcher impara [-p profilo]              proposte numerate: parole da escludere o da premiare
  job-searcher impara applica <n> [-p profilo]  aggiunge la proposta n al profilo
  job-searcher impara ignora <n> [-p profilo]   «no, grazie»: non la propone più
`;

async function profileId(opts) {
  if (opts.profile) return slugify(path.basename(opts.profile, '.json'));
  const profiles = await listProfiles();
  if (profiles.length === 1) return profiles[0].id;
  throw new Error(`Indica il profilo con -p (${profiles.map((p) => p.id).join(', ') || 'nessun profilo salvato'})`);
}

export async function learnCommand(opts) {
  const [action, n] = opts.args;
  const id = await profileId(opts);
  const { profile, suggestions } = await learnForProfile(id);
  if (action === 'applica' || action === 'ignora') {
    const s = suggestions[Number(n) - 1];
    if (!s) throw new Error(`Proposta ${n ?? ''} non trovata: "job-searcher impara -p ${id}" le elenca`);
    if (action === 'ignora') {
      await dismissSuggestion(id, s.id);
      return console.log(`${c.green('✓')} Non propongo più: ${s.title}`);
    }
    await saveProfile(id, applySuggestion(profile, s), { overwrite: true });
    const where = s.kind === 'exclude' ? 'parole escluse' : 'parole bonus';
    return console.log(`${c.green('✓')} «${s.term}» aggiunta alle ${where} del profilo ${id}.`);
  }
  if (!suggestions.length) {
    return console.log(
      'Nessuna proposta per ora: servono almeno 3 offerte scartate (o 2 seguite) con la stessa parola nel titolo.',
    );
  }
  console.log(c.bold(`Proposte per il profilo ${id}, dalle tue scelte:`));
  suggestions.forEach((s, i) => {
    console.log(`\n${c.bold(`${i + 1}.`)} ${s.title}`);
    console.log(`   ${c.dim(s.text)}`);
  });
  console.log(
    `\n${c.dim(`Per applicarne una: job-searcher impara applica <n> -p ${id}; per scartarla: impara ignora <n>`)}`,
  );
}

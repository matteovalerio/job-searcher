import { readFile, writeFile } from 'node:fs/promises';
import {
  buildFollowUp,
  buildKit,
  buildKitPrompt,
  companySiteFromJob,
  cvContacts,
  findCompany,
  importKitAnswer,
} from '../kit.js';
import { c } from '../output/terminal.js';
import { readCvText } from '../profiles/cv.js';
import { checkPublisherSite } from '../publishers/discover.js';
import { Publishers } from '../publishers/store.js';
import { loadCvText } from '../tailor.js';
import { findInLastResults, Tracking } from '../tracking.js';

export const KIT_HELP = `
Kit di candidatura per un'offerta (il codice è quello tra [ ] nei risultati):
  job-searcher kit <codice> [--text annuncio.txt]   analisi, CV riordinato, email e sollecito (senza IA);
                                                    --text: il testo completo dell'annuncio, se il portale
                                                    ne mostra solo un pezzo
  job-searcher kit <codice> --prompt [-o file]      testo per claude.ai con CV, annuncio e analisi
  job-searcher kit <codice> import [file]           importa la risposta di Claude (e la controlla)
  job-searcher track <codice> candidatura [--date AAAA-MM-GG]   segna l'invio: il sollecito si programma
  job-searcher track <codice> sollecito             segna un sollecito inviato (e programma il successivo)
  job-searcher track solleciti                      le candidature da sollecitare
`;

async function readInput(file) {
  if (file) return readFile(file, 'utf8');
  if (process.stdin.isTTY) console.error('Incolla la risposta di Claude, poi premi Invio e Ctrl+D:');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** L'offerta: negli ultimi risultati o tra quelle seguite (con il testo salvato nel kit). */
async function findJob(ref, tracking) {
  const item = tracking.find(ref);
  const job = (await findInLastResults(ref)) ?? (item ? { ...item.job, description: item.kit?.offerText ?? '' } : null);
  if (!job) {
    throw new Error(`Offerta "${ref}" non trovata: rilancia la ricerca e usa il codice tra [ ] accanto all'offerta.`);
  }
  return { job, item };
}

const rule = (title) => console.log(`\n${c.bold(c.cyan(`── ${title} `.padEnd(60, '─')))}`);

function printKit(kit, item) {
  rule('Cosa chiede l’annuncio e cosa mostra il CV');
  for (const r of kit.covered) {
    console.log(`  ${c.green('✓')} ${r.requirement}${r.task ? c.dim(' (mansione)') : ''}`);
    console.log(c.dim(`      nel CV: «${r.evidence.join('» / «')}»`));
    if (r.note) console.log(`      ${c.yellow(r.note)}`);
  }
  for (const m of kit.missing) {
    console.log(`  ${c.red('✗')} ${m}`);
    console.log(c.dim('      non lo trovo nel CV: non scriverlo; se è vero, aggiungilo al CV'));
  }
  if (kit.shortText) {
    console.log(c.yellow('\n  Il testo dell’annuncio è breve: copialo dal sito e rilancia con --text annuncio.txt.'));
  }
  if (kit.cv) {
    rule('CV (solo righe del tuo CV, riordinate)');
    console.log(kit.cv.text);
    for (const ch of kit.cv.changes) console.log(c.dim(`  · ${ch}`));
  } else {
    console.log(c.yellow('\nNessun CV salvato: salvalo con "job-searcher cv set <file.pdf>".'));
  }
  rule('Email');
  console.log(`${c.dim('A:')} ${kit.company.email ?? c.dim('indirizzo non trovato: usa quello dell’annuncio')}`);
  console.log(`${c.dim('Oggetto:')} ${kit.email.subject}\n`);
  console.log(kit.email.body);
  rule('Sollecito');
  console.log(`${c.dim('Oggetto:')} ${kit.followUp.subject}\n`);
  console.log(kit.followUp.body);
  console.log(
    c.dim(
      `\nKit salvato nella candidatura [${item.shortId}]. Dopo l'invio: job-searcher track ${item.shortId} candidatura`,
    ),
  );
}

export async function kitCommand(opts) {
  const [ref, action, file] = opts.args;
  if (!ref) {
    console.log(KIT_HELP);
    return;
  }
  const tracking = await new Tracking().load();
  const { job, item } = await findJob(ref, tracking);
  const cvText = opts.cv ? await readCvText(opts.cv) : ((await loadCvText()) ?? '');

  if (action === 'import') {
    if (!item?.kit) throw new Error(`Prepara prima il kit: job-searcher kit ${ref}`);
    const claude = importKitAnswer(await readInput(file), { cvText, offerText: item.kit.offerText });
    tracking.setKit(item.job, { ...item.kit, claude: { ...claude, importedAt: new Date().toISOString() } });
    await tracking.save();
    for (const w of claude.warnings) console.error(c.yellow(`! ${w}`));
    rule('CV di Claude');
    console.log(claude.cv);
    rule('Email di Claude');
    console.log(`${c.dim('Oggetto:')} ${claude.email.subject}\n\n${claude.email.body}`);
    console.log(c.dim('\nImportato nel kit (lo vedi anche nella pagina web).'));
    return;
  }

  const text = opts.text ? await readFile(opts.text, 'utf8') : undefined;
  const publishers = await new Publishers().load();
  let site = item?.kit?.site ?? null;
  const website = companySiteFromJob(job);
  if (!site && website && !findCompany(job, publishers.items)) {
    const found = await checkPublisherSite({ website });
    site = found.problem ? { website, problem: found.problem } : { website, ...found };
  }
  const kit = buildKit({ job, text: text ?? item?.kit?.offerText, cvText, publishers: publishers.items, site });
  const saved = tracking.setKit(job, {
    ...kit,
    site,
    claude: item?.kit?.claude ?? null,
    createdAt: item?.kit?.createdAt ?? new Date().toISOString(),
  });
  await tracking.save();
  if (saved.sentAt) {
    kit.followUp = buildFollowUp({
      job,
      company: kit.company,
      contacts: cvContacts(cvText),
      sentAt: saved.sentAt,
      language: kit.language,
    });
  }

  if (opts.prompt) {
    const prompt = buildKitPrompt(kit, cvText);
    if (opts.out) {
      await writeFile(opts.out, prompt);
      console.error(`Testo salvato in ${opts.out}: incollalo su claude.ai, poi "job-searcher kit ${ref} import".`);
    } else console.log(prompt);
    return;
  }
  printKit(kit, saved);
}

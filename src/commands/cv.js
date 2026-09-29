import { writeFile } from 'node:fs/promises';
import { c } from '../output/terminal.js';
import { readCvText } from '../profiles/cv.js';
import { guessKind } from '../publishers/specialties.js';
import { Publishers } from '../publishers/store.js';
import { buildTailorPrompt, cvInfo, emphasisFor, loadCvText, saveCvText } from '../tailor.js';
import { findInLastResults } from '../tracking.js';

export const CV_HELP = `
CV su misura:
  job-searcher cv set <file.pdf>            salva il testo del CV (resta sul computer, in .job-searcher/cv.txt)
  job-searcher cv                           dice se c'è un CV salvato
  job-searcher cv tailor <codice | casa editrice> [-o file] [--cv file.pdf]
                                            prepara il testo per claude.ai (o un altro assistente) che adatta il CV
                                            a un'offerta (codice tra [ ]) o a una casa editrice dell'elenco
`;

/** Destinatario: un'offerta degli ultimi risultati (per codice) o una casa editrice dell'elenco. */
async function findTarget(ref) {
  const job = await findInLastResults(ref);
  if (job) {
    const text = [job.title, job.company, job.description].join(' ');
    return { target: { type: 'job', job }, emphasis: emphasisFor({ text, kind: guessKind(job.company ?? '') }) };
  }
  const publisher = (await new Publishers().load()).find(ref);
  if (publisher) {
    const emphasis = emphasisFor({
      specialties: publisher.specialties,
      kind: publisher.kind,
      text: [publisher.name, publisher.description].join(' '),
    });
    return { target: { type: 'publisher', publisher }, emphasis };
  }
  throw new Error(`"${ref}" non è il codice di un'offerta degli ultimi risultati né una casa editrice dell'elenco.`);
}

export async function cvCommand(opts) {
  const [sub, ref] = opts.args;
  if (!sub || sub === 'show') {
    const info = await cvInfo();
    console.log(
      info.saved
        ? `CV salvato il ${info.updatedAt.slice(0, 10)} (${info.chars} caratteri).`
        : 'Nessun CV salvato. Salvalo con: job-searcher cv set ~/Documenti/cv.pdf',
    );
    return;
  }
  if (sub === 'set') {
    if (!ref) throw new Error('Indica il PDF: job-searcher cv set ~/Documenti/cv.pdf');
    const text = await readCvText(ref);
    await saveCvText(text);
    console.log(c.green(`CV salvato (${text.length} caratteri). Serve a "cv tailor" e alla pagina web.`));
    return;
  }
  if (sub === 'tailor' || sub === 'su-misura') {
    if (!ref) throw new Error("Indica il codice di un'offerta o una casa editrice: job-searcher cv tailor 3359919");
    const { target, emphasis } = await findTarget(ref);
    const cvText = opts.cv ? await readCvText(opts.cv) : await loadCvText();
    const prompt = buildTailorPrompt({ cvText: cvText ?? '', target, emphasis });
    const name = target.type === 'job' ? `${target.job.title} (${target.job.company ?? '?'})` : target.publisher.name;
    const hints = [
      `Destinatario: ${name}`,
      `Specializzazione: ${emphasis.specialties.map((s) => s.label).join(', ') || 'non riconosciuta'}`,
      cvText ? 'Il testo del CV è incluso.' : 'Nessun CV salvato: allegalo nella chat (o salvalo con "cv set").',
      'Incolla il testo in una nuova chat su claude.ai (funziona anche con altri assistenti).',
    ].join('\n');
    if (opts.out) {
      await writeFile(opts.out, prompt);
      console.log(c.green(`Testo salvato in ${opts.out}`));
      console.log(hints);
    } else {
      console.log(prompt);
      console.error(c.dim(`\n${'-'.repeat(60)}\n${hints}`));
    }
    return;
  }
  throw new Error(`Sottocomando sconosciuto "cv ${sub}". Usa: cv set <pdf> | cv tailor <codice o casa editrice>`);
}

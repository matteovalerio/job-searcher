import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/**
 * Testo per adattare il CV a un'offerta o a una casa editrice.
 * Corpo: { job: <id o codice dell'offerta> } oppure { publisher: <id> }
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { findInLastResults, Publishers, emphasisFor, guessKind, buildTailorPrompt, loadCvText } = await core();
  let target;
  let emphasis;
  if (body.job) {
    const job = await findInLastResults(body.job);
    if (!job) return Response.json({ error: 'Offerta non trovata negli ultimi risultati' }, { status: 404 });
    target = { type: 'job', job };
    emphasis = emphasisFor({
      text: [job.title, job.company, job.description].join(' '),
      kind: guessKind(job.company ?? ''),
    });
  } else if (body.publisher) {
    const publisher = (await new Publishers().load()).get(body.publisher);
    if (!publisher) return Response.json({ error: 'Casa editrice non trovata' }, { status: 404 });
    target = { type: 'publisher', publisher };
    emphasis = emphasisFor({
      specialties: publisher.specialties,
      kind: publisher.kind,
      text: [publisher.name, publisher.description].join(' '),
    });
  } else {
    return Response.json({ error: "Indica l'offerta o la casa editrice" }, { status: 400 });
  }
  const cvText = await loadCvText();
  return Response.json({
    prompt: buildTailorPrompt({ cvText: cvText ?? '', target, emphasis }),
    emphasis,
    hasCv: Boolean(cvText),
    title: target.type === 'job' ? target.job.title : target.publisher.name,
  });
}

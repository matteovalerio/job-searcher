import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** L'offerta: negli ultimi risultati, tra quelle seguite o tra i kit già fatti (con il testo salvato). */
async function findJob(ref, tracking, kits, findInLastResults) {
  const item = tracking.find(ref);
  const saved = kits.find(ref);
  const fromResults = await findInLastResults(ref);
  if (fromResults) return { job: fromResults, item, saved };
  const known = item?.job ?? saved?.job;
  if (known) return { job: { ...known, description: saved?.offerText ?? '' }, item, saved };
  return { job: null, item, saved };
}

/** Il kit da mandare all'interfaccia: il sollecito cita la data di invio, se c'è. */
function response(c, kit, item, cvText) {
  const followUp = item?.sentAt
    ? c.buildFollowUp({
        job: kit.job,
        company: kit.company,
        contacts: c.cvContacts(cvText),
        sentAt: item.sentAt,
        language: kit.language,
      })
    : kit.followUp;
  return {
    kit: { ...kit, followUp },
    item: item ?? null,
    prompt: c.buildKitPrompt(kit, cvText),
    statuses: c.STATUSES,
  };
}

/** Kit salvato di un'offerta, con il testo per Claude. ?job=<id> */
export async function GET(request) {
  const ref = new URL(request.url).searchParams.get('job');
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const kit = kits.find(ref);
  if (!kit) return Response.json({ kit: null });
  return Response.json(response(c, kit, tracking.get(kit.job.id), (await c.loadCvText()) ?? ''));
}

/**
 * Prepara (o rifà) il kit con lo strumento interno e lo salva tra i kit (senza seguire l'offerta).
 * Corpo: { job: <id o codice dell'offerta>, text?: testo completo dell'annuncio incollato }
 */
export async function POST(request) {
  const { job: ref, text } = await request.json().catch(() => ({}));
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const { job, item, saved } = await findJob(ref, tracking, kits, c.findInLastResults);
  if (!job) return Response.json({ error: 'Offerta non trovata: rilancia la ricerca' }, { status: 404 });
  const [cvText, publishers] = await Promise.all([c.loadCvText(), new c.Publishers().load()]);

  // Se l'annuncio è sul sito dell'azienda (e l'azienda non è già nell'elenco) si visita il sito una volta.
  let site = saved?.site ?? null;
  const website = c.companySiteFromJob(job);
  if (!site && website && !c.findCompany(job, publishers.items)) {
    const found = await c.checkPublisherSite({ website });
    site = found.problem ? { website, problem: found.problem } : { website, ...found };
  }
  const kit = c.buildKit({
    job,
    text: text ?? saved?.offerText,
    cvText: cvText ?? '',
    publishers: publishers.items,
    site,
  });
  const stored = kits.set(job, {
    ...kit,
    site,
    claude: saved?.claude ?? null,
    createdAt: saved?.createdAt ?? new Date().toISOString(),
  });
  await kits.save();
  return Response.json(response(c, stored, item, cvText ?? ''));
}

/** Importa la risposta di Claude. Corpo: { job, answer } */
export async function PUT(request) {
  const { job: ref, answer } = await request.json().catch(() => ({}));
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const saved = kits.find(ref);
  if (!saved) return Response.json({ error: 'Prepara prima il kit' }, { status: 400 });
  const cvText = (await c.loadCvText()) ?? '';
  try {
    const claude = c.importKitAnswer(String(answer ?? ''), { cvText, offerText: saved.offerText });
    const stored = kits.set(saved.job, { ...saved, claude: { ...claude, importedAt: new Date().toISOString() } });
    await kits.save();
    return Response.json(response(c, stored, tracking.get(saved.job.id), cvText));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

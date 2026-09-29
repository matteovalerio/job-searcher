import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** L'offerta: tra quelle seguite (con il testo salvato nel kit) o negli ultimi risultati. */
async function findJob(ref, tracking, findInLastResults) {
  const item = tracking.find(ref);
  const fromResults = await findInLastResults(ref);
  if (fromResults) return { job: fromResults, item };
  if (item) return { job: { ...item.job, description: item.kit?.offerText ?? '' }, item };
  return { job: null, item: null };
}

/** Il kit da mandare all'interfaccia: il sollecito cita la data di invio, se c'è. */
function response(c, item, cvText) {
  const kit = item.kit;
  const followUp = item.sentAt
    ? c.buildFollowUp({
        job: item.job,
        company: kit.company,
        contacts: c.cvContacts(cvText),
        sentAt: item.sentAt,
        language: kit.language,
      })
    : kit.followUp;
  return {
    kit: { ...kit, followUp },
    item,
    prompt: c.buildKitPrompt(kit, cvText),
    statuses: c.STATUSES,
  };
}

/** Kit salvato di un'offerta, con il testo per Claude. ?job=<id> */
export async function GET(request) {
  const ref = new URL(request.url).searchParams.get('job');
  const c = await core();
  const tracking = await new c.Tracking().load();
  const item = tracking.find(ref);
  if (!item?.kit) return Response.json({ kit: null });
  return Response.json(response(c, item, (await c.loadCvText()) ?? ''));
}

/**
 * Prepara (o rifà) il kit con lo strumento interno e lo salva nella candidatura.
 * Corpo: { job: <id o codice dell'offerta>, text?: testo completo dell'annuncio incollato }
 */
export async function POST(request) {
  const { job: ref, text } = await request.json().catch(() => ({}));
  const c = await core();
  const tracking = await new c.Tracking().load();
  const { job, item } = await findJob(ref, tracking, c.findInLastResults);
  if (!job) return Response.json({ error: 'Offerta non trovata: rilancia la ricerca' }, { status: 404 });
  const [cvText, publishers] = await Promise.all([c.loadCvText(), new c.Publishers().load()]);

  // Se l'annuncio è sul sito dell'azienda (e l'azienda non è già nell'elenco) si visita il sito una volta.
  let site = item?.kit?.site ?? null;
  const website = c.companySiteFromJob(job);
  if (!site && website && !c.findCompany(job, publishers.items)) {
    const found = await c.checkPublisherSite({ website });
    site = found.problem ? { website, problem: found.problem } : { website, ...found };
  }
  const kit = c.buildKit({
    job,
    text: text ?? item?.kit?.offerText,
    cvText: cvText ?? '',
    publishers: publishers.items,
    site,
  });
  const saved = tracking.setKit(job, {
    ...kit,
    site,
    claude: item?.kit?.claude ?? null,
    createdAt: item?.kit?.createdAt ?? new Date().toISOString(),
  });
  await tracking.save();
  return Response.json(response(c, saved, cvText ?? ''));
}

/** Importa la risposta di Claude. Corpo: { job, answer } */
export async function PUT(request) {
  const { job: ref, answer } = await request.json().catch(() => ({}));
  const c = await core();
  const tracking = await new c.Tracking().load();
  const item = tracking.find(ref);
  if (!item?.kit) return Response.json({ error: 'Prepara prima il kit' }, { status: 400 });
  const cvText = (await c.loadCvText()) ?? '';
  try {
    const claude = c.importKitAnswer(String(answer ?? ''), { cvText, offerText: item.kit.offerText });
    const saved = tracking.setKit(item.job, {
      ...item.kit,
      claude: { ...claude, importedAt: new Date().toISOString() },
    });
    await tracking.save();
    return Response.json(response(c, saved, cvText));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

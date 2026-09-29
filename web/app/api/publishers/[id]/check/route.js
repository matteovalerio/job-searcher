import { core } from '../../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Visita il sito della casa editrice: specializzazione, email, pagina "lavora con noi". */
export async function POST(_request, { params }) {
  const { id } = await params;
  const { Publishers, checkPublisherSite, needsFollowUp } = await core();
  const store = await new Publishers().load();
  const p = store.get(id);
  if (!p) return Response.json({ error: 'Non trovata' }, { status: 404 });
  const found = await checkPublisherSite(p);
  // Si ricarica prima di salvare: nel frattempo potrebbe essere cambiato qualcos'altro.
  const fresh = await new Publishers().load();
  const updated = fresh.enrich(id, found);
  await fresh.save();
  return Response.json({ ...updated, followUpDue: needsFollowUp(updated) });
}

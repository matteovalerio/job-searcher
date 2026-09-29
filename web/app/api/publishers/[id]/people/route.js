import { core } from '../../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Chi contattare: persone e ruoli dalle pagine "chi siamo", "redazione", "contatti" del sito. */
export async function POST(_request, { params }) {
  const { id } = await params;
  const { Publishers, findPeople, needsFollowUp } = await core();
  const p = (await new Publishers().load()).get(id);
  if (!p) return Response.json({ error: 'Non trovata' }, { status: 404 });
  const found = await findPeople(p.website);
  // Si ricarica prima di salvare: nel frattempo potrebbe essere cambiato qualcos'altro.
  const fresh = await new Publishers().load();
  const updated = fresh.setPeople(id, found);
  await fresh.save();
  return Response.json({ ...updated, followUpDue: needsFollowUp(updated) });
}

import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Elenco delle case editrici, con stati, tipi e specializzazioni per il modulo. */
export async function GET() {
  const { Publishers, PUBLISHER_STATUSES, PUBLISHER_KINDS, SPECIALTIES, needsFollowUp } = await core();
  const store = await new Publishers().load();
  return Response.json({
    items: store.list().map((p) => ({ ...p, followUpDue: needsFollowUp(p) })),
    statuses: PUBLISHER_STATUSES,
    kinds: PUBLISHER_KINDS,
    specialties: SPECIALTIES.map(({ id, label }) => ({ id, label })),
  });
}

/**
 * Aggiunge case editrici. Corpo: { publisher } (a mano: se ha un sito lo si visita subito) oppure
 * { items: [...] } (dalla ricerca). Risponde con quelle aggiunte e quante erano già presenti.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { Publishers, checkPublisherSite, needsFollowUp } = await core();
  const store = await new Publishers().load();
  try {
    const list = body.items ?? (body.publisher ? [body.publisher] : []);
    const added = list.map((p) => store.add(p)).filter(Boolean);
    if (body.publisher && added[0]?.website) store.enrich(added[0].id, await checkPublisherSite(added[0]));
    await store.save();
    if (body.publisher && !added.length) {
      return Response.json({ error: "È già nell'elenco (stesso sito o stesso nome)." }, { status: 409 });
    }
    return Response.json({
      added: added.map((p) => ({ ...p, followUpDue: needsFollowUp(p) })),
      skipped: list.length - added.length,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

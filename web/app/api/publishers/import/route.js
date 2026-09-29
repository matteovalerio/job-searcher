import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/**
 * Aggiunge le case editrici di un testo (risposta di Claude o una per riga) e ne visita i siti, tre alla volta.
 * Corpo: { text }. Risponde con quelle aggiunte, già controllate.
 */
export async function POST(request) {
  const { text = '' } = await request.json().catch(() => ({}));
  const { parsePublisherList, Publishers, checkPublisherSite, needsFollowUp } = await core();
  const list = parsePublisherList(text);
  if (!list.length) return Response.json({ error: 'Nel testo non ho trovato nessuna casa editrice.' }, { status: 400 });
  const store = await new Publishers().load();
  const added = list.map((p) => store.add(p)).filter(Boolean);
  await store.save();
  const queue = [...added];
  const found = new Map();
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) found.set(p.id, await checkPublisherSite(p));
    }),
  );
  // Si ricarica prima di salvare: nel frattempo potrebbe essere cambiato qualcos'altro.
  const fresh = await new Publishers().load();
  const checked = added.map((p) => fresh.enrich(p.id, found.get(p.id)));
  await fresh.save();
  return Response.json({
    added: checked.map((p) => ({ ...p, followUpDue: needsFollowUp(p) })),
    skipped: list.length - added.length,
  });
}

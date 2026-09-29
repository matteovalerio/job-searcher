import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Toglie le voci di Wikidata senza sito mai toccate (stampatori storici, editori non più attivi). */
export async function POST() {
  const { Publishers } = await core();
  const store = await new Publishers().load();
  const stale = store.staleFromWikidata();
  for (const p of stale) store.remove(p.id);
  await store.save();
  return Response.json({ removed: stale.map((p) => p.id) });
}

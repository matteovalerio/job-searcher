import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Testo per farsi elencare da Claude le case editrici di una zona. Corpo: { place, radiusKm } */
export async function POST(request) {
  const { place = '', radiusKm = 30 } = await request.json().catch(() => ({}));
  const { buildPublishersPrompt, Publishers } = await core();
  const places = place
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!places.length) return Response.json({ error: 'Indica almeno una città' }, { status: 400 });
  const store = await new Publishers().load();
  return Response.json({
    prompt: buildPublishersPrompt({ places, radiusKm: Number(radiusKm) || 30, known: store.items.map((p) => p.name) }),
  });
}

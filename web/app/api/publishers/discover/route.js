import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Cerca case editrici attorno a una città. Corpo: { place, radiusKm } */
export async function POST(request) {
  const { place, radiusKm = 30 } = await request.json().catch(() => ({}));
  const { discoverPublishers, Publishers } = await core();
  try {
    const [{ center, results, problems }, store] = await Promise.all([
      discoverPublishers({ place, radiusKm: Number(radiusKm) || 30 }),
      new Publishers().load(),
    ]);
    return Response.json({ center, problems, results: results.map((r) => ({ ...r, known: store.has(r) })) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Cerca aziende attorno a una o più città. Corpo: { place, radiusKm, sectors? } (predefiniti: editoria) */
export async function POST(request) {
  const { place, radiusKm = 30, sectors } = await request.json().catch(() => ({}));
  const { discoverPublishers, Publishers, resolveSectors } = await core();
  try {
    const [{ center, results, problems, webSearch }, store] = await Promise.all([
      discoverPublishers({ place, radiusKm: Number(radiusKm) || 30, sectors: resolveSectors(sectors) }),
      new Publishers().load(),
    ]);
    return Response.json({
      center,
      problems,
      webSearch,
      results: results.map((r) => ({ ...r, known: store.has(r) })),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

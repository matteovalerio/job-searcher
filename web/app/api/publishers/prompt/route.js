import { activeProfileId } from '../../../../lib/active-profile.js';
import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/**
 * Testo per Claude: le case editrici della zona, oppure (affine: true) le aziende affini al CV o al profilo
 * attivo. Corpo: { place, radiusKm, affine? }
 */
export async function POST(request) {
  const { place = '', radiusKm = 30, affine = false } = await request.json().catch(() => ({}));
  const {
    buildPublishersPrompt,
    buildAffinePrompt,
    Publishers,
    listProfiles,
    loadProfile,
    candidateText,
    affineSectors,
  } = await core();
  const places = place
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!places.length) return Response.json({ error: 'Indica almeno una città' }, { status: 400 });
  const store = await new Publishers().load();
  const known = store.items.map((p) => p.name);
  const km = Number(radiusKm) || 30;
  if (!affine) return Response.json({ prompt: buildPublishersPrompt({ places, radiusKm: km, known }) });

  const profiles = await listProfiles();
  const activeId = await activeProfileId(profiles);
  const profile = activeId ? await loadProfile(activeId).catch(() => null) : null;
  const who = await candidateText(profile ?? null);
  if (!who.text) {
    return Response.json(
      { error: 'Per le aziende affini serve il CV (caricalo in «CV su misura» o in «Nuovo profilo») o un profilo.' },
      { status: 400 },
    );
  }
  return Response.json({
    prompt: buildAffinePrompt({
      candidate: who.cv ?? who.text,
      hasCv: Boolean(who.cv),
      places,
      radiusKm: km,
      suggested: affineSectors(who.text),
      known,
    }),
  });
}

import { activeProfileId } from '../../lib/active-profile.js';
import { core } from '../../lib/core.js';
import PublishersBoard from './PublishersBoard.js';

export const dynamic = 'force-dynamic';

export default async function CaseEditrici() {
  const {
    Publishers,
    PUBLISHER_STATUSES,
    PUBLISHER_KINDS,
    SPECIALTIES,
    SECTORS,
    PUBLISHING_SECTORS,
    needsFollowUp,
    listProfiles,
    loadProfile,
    candidateText,
    suggestSectors,
    affineSectors,
    loadWatch,
    describeEvent,
  } = await core();
  const watchState = await loadWatch();
  const [store, profiles] = await Promise.all([new Publishers().load(), listProfiles()]);
  // La ricerca parte dalla prima città del profilo attivo.
  const activeId = await activeProfileId(profiles);
  const active = profiles.find((p) => p.id === activeId);
  const place = active?.targets.flatMap((t) => t.places ?? (t.place ? [t.place] : []))[0] ?? '';
  // Settori affini consigliati in base al profilo attivo e al CV salvato.
  const who = await candidateText(activeId ? await loadProfile(activeId).catch(() => null) : null);
  const scores = Object.fromEntries(suggestSectors(who.text).map((s) => [s.id, s.score]));
  const recommended = affineSectors(who.text);
  const sectors = SECTORS.map(({ id, label, why, roles }) => ({
    id,
    label,
    why,
    roles,
    publishing: PUBLISHING_SECTORS.includes(id),
    recommended: recommended.includes(id),
    score: scores[id] ?? 0,
  })).sort((a, b) => b.publishing - a.publishing || b.score - a.score);
  return (
    <PublishersBoard
      initialItems={store.list().map((p) => ({ ...p, followUpDue: needsFollowUp(p) }))}
      statuses={PUBLISHER_STATUSES}
      kinds={PUBLISHER_KINDS}
      specialties={SPECIALTIES.map(({ id, label }) => ({ id, label }))}
      defaultPlace={place}
      sectors={sectors}
      initialWatch={{
        events: (watchState.events ?? []).slice(0, 30).map((e) => ({ ...e, description: describeEvent(e) })),
        checkedAt:
          Object.values(watchState.byId)
            .map((s) => s.checkedAt)
            .sort()
            .at(-1) ?? null,
      }}
      initialStale={store.staleFromWikidata().length}
    />
  );
}

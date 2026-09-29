import { activeProfileId } from '../../lib/active-profile.js';
import { core } from '../../lib/core.js';
import PublishersBoard from './PublishersBoard.js';

export const dynamic = 'force-dynamic';

export default async function CaseEditrici() {
  const { Publishers, PUBLISHER_STATUSES, PUBLISHER_KINDS, SPECIALTIES, needsFollowUp, listProfiles } = await core();
  const [store, profiles] = await Promise.all([new Publishers().load(), listProfiles()]);
  // La ricerca parte dalla prima città del profilo attivo.
  const activeId = await activeProfileId(profiles);
  const active = profiles.find((p) => p.id === activeId);
  const place = active?.targets.flatMap((t) => t.places ?? (t.place ? [t.place] : []))[0] ?? '';
  return (
    <PublishersBoard
      initialItems={store.list().map((p) => ({ ...p, followUpDue: needsFollowUp(p) }))}
      statuses={PUBLISHER_STATUSES}
      kinds={PUBLISHER_KINDS}
      specialties={SPECIALTIES.map(({ id, label }) => ({ id, label }))}
      defaultPlace={place}
      initialStale={store.staleFromWikidata().length}
    />
  );
}

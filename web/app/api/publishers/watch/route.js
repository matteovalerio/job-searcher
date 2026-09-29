import { activeProfileId } from '../../../../lib/active-profile.js';
import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

const recent = (events, describeEvent) => events.slice(0, 30).map((e) => ({ ...e, description: describeEvent(e) }));

/** Novità recenti della sorveglianza e data dell'ultimo controllo. */
export async function GET() {
  const { loadWatch, describeEvent } = await core();
  const state = await loadWatch();
  const checked =
    Object.values(state.byId)
      .map((s) => s.checkedAt)
      .sort()
      .at(-1) ?? null;
  return Response.json({ events: recent(state.events ?? [], describeEvent), checkedAt: checked });
}

/** Controlla ora tutte le aziende dell'elenco (può richiedere qualche minuto). */
export async function POST() {
  const { Publishers, loadWatch, saveWatch, watchPublishers, describeEvent, listProfiles, loadProfile } = await core();
  const [store, state, profiles] = await Promise.all([new Publishers().load(), loadWatch(), listProfiles()]);
  const activeId = await activeProfileId(profiles);
  const profile = activeId ? await loadProfile(activeId).catch(() => null) : null;
  const firstTime = Object.keys(state.byId).length === 0;
  const { events, checked, problems } = await watchPublishers(store, state, { profile });
  // Si ricarica l'elenco prima di salvare, per non perdere modifiche fatte nel frattempo.
  const fresh = await new Publishers().load();
  for (const p of store.items) if (p.careersUrl) fresh.enrich(p.id, { careersUrl: p.careersUrl });
  await Promise.all([fresh.save(), saveWatch(state)]);
  return Response.json({
    found: recent(events, describeEvent),
    events: recent(state.events, describeEvent),
    checked,
    problems,
    firstTime,
    checkedAt: new Date().toISOString(),
  });
}

import { activeProfileId } from './active-profile.js';
import { core } from './core.js';

/** Testo del profilo attivo e comune di casa: servono a ordinare gli eventi per pertinenza e distanza. */
export async function eventsForActiveProfile() {
  const { listProfiles, loadProfile, upcomingEvents, associations } = await core();
  const profiles = await listProfiles();
  const id = await activeProfileId(profiles);
  const profile = id ? await loadProfile(id).catch(() => ({})) : {};
  const profileText = [
    profile.name,
    profile.description,
    ...(profile.keywords ?? []),
    ...(profile.relatedKeywords ?? []),
    ...(profile.candidate?.areas ?? []),
  ].join(' ');
  const home = profile.targets?.find((t) => t.type === 'area')?.places?.[0] ?? null;
  return {
    home,
    events: upcomingEvents({ profileText, home }),
    associations: associations(profileText),
  };
}

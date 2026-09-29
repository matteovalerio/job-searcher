import { activeProfileId } from './active-profile.js';
import { core } from './core.js';

/** Analisi del mercato per il profilo attivo: storico delle offerte (o ultimi risultati) e CV salvato. */
export async function marketForActiveProfile() {
  const { listProfiles, loadHistory, loadLastResults, jobFeatures, analyzeMarket, loadCvText } = await core();
  const profiles = await listProfiles();
  const id = await activeProfileId(profiles);
  if (!id) return null;
  const profile = profiles.find((p) => p.id === id);
  let features = Object.values((await loadHistory(id)).jobs);
  if (!features.length) {
    const last = await loadLastResults(id);
    features = last ? last.targets.flatMap((t) => t.jobs).map(jobFeatures) : [];
  }
  const cvText = (await loadCvText()) ?? '';
  return { id, name: profile?.name ?? id, analysis: analyzeMarket(features, cvText), cvText, found: features.length };
}

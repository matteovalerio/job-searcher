import { core } from '../../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Proposte per il profilo, dalle scelte fatte sulle offerte. */
export async function GET(_request, { params }) {
  const { id } = await params;
  const { learnForProfile } = await core();
  try {
    const { suggestions } = await learnForProfile(id);
    return Response.json({ suggestions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}

/** Applica una proposta al profilo o la scarta. Corpo: { suggestion: "exclude:commerciale", action: "apply"|"dismiss" }. */
export async function POST(request, { params }) {
  const { id } = await params;
  const { learnForProfile, applySuggestion, dismissSuggestion, saveProfile } = await core();
  const { suggestion, action } = await request.json();
  const { profile, suggestions } = await learnForProfile(id);
  const s = suggestions.find((x) => x.id === suggestion);
  if (!s) return Response.json({ error: 'Proposta non trovata (forse è già stata applicata)' }, { status: 404 });
  let updated = profile;
  if (action === 'apply') {
    updated = applySuggestion(profile, s);
    await saveProfile(id, updated, { overwrite: true });
  } else await dismissSuggestion(id, s.id);
  const after = await learnForProfile(id);
  return Response.json({ suggestions: after.suggestions, profile: updated });
}

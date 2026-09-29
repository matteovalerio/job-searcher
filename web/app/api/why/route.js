import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Perché un'offerta di LinkedIn non compare. Corpo: { url, profile } */
export async function POST(request) {
  const { url, profile } = await request.json().catch(() => ({}));
  const { loadProfile, resolveProfile, diagnoseLinkedin } = await core();
  try {
    const resolved = resolveProfile(await loadProfile(profile), { onlySources: ['linkedin'] });
    return Response.json(await diagnoseLinkedin(url, resolved));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

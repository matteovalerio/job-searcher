import { core, resultsForPage } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const profile = new URL(request.url).searchParams.get('profile');
  if (!profile) return Response.json({ error: 'Manca il profilo' }, { status: 400 });
  const { slugify } = await core();
  return Response.json(await resultsForPage(slugify(profile)));
}

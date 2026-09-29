import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Ricalcola le proposte per le aree scelte. Corpo: { families, years, skills, languages } */
export async function POST(request) {
  const { families = [], years = 0, skills = [], languages = [] } = await request.json().catch(() => ({}));
  const { suggest } = await core();
  return Response.json(suggest(families, { years, skills, languages }));
}

/** Aree professionali e ambiti del remoto disponibili, per il modulo. */
export async function GET() {
  const { ROLE_FAMILIES, REMOTE_SCOPES } = await core();
  return Response.json({
    families: ROLE_FAMILIES.map(({ id, label }) => ({ id, label })),
    remoteScopes: Object.fromEntries(Object.entries(REMOTE_SCOPES).map(([k, v]) => [k, v.label])),
  });
}

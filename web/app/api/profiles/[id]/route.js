import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { id } = await params;
  const { loadProfile } = await core();
  try {
    return Response.json(await loadProfile(id));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}

/** Salva un profilo modificato, dopo gli stessi controlli della ricerca. Corpo: il profilo in JSON. */
export async function PUT(request, { params }) {
  const { id } = await params;
  const { checkImported, saveProfile } = await core();
  let profile;
  try {
    profile = checkImported(await request.json());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  const file = await saveProfile(id, profile, { overwrite: true });
  return Response.json({ ok: true, file });
}

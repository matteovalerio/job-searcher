import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Cambia stato e dati della candidatura. Corpo: { status?, note?, sentAt?, followUpAt?, … } */
export async function PUT(request, { params }) {
  const { id } = await params;
  const patch = await request.json().catch(() => ({}));
  const { Publishers, needsFollowUp } = await core();
  const store = await new Publishers().load();
  try {
    const p = store.update(id, patch);
    await store.save();
    return Response.json({ ...p, followUpDue: needsFollowUp(p) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const { Publishers } = await core();
  const store = await new Publishers().load();
  if (!store.remove(id)) return Response.json({ error: 'Non trovata' }, { status: 404 });
  await store.save();
  return Response.json({ ok: true });
}

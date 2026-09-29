import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { STATUSES, Tracking } = await core();
  const tracking = await new Tracking().load();
  return Response.json({ statuses: STATUSES, items: tracking.list() });
}

/** Imposta stato e/o nota. Corpo: { job: { id, title, … }, status?, note? } */
export async function POST(request) {
  const { job, status, note } = await request.json().catch(() => ({}));
  if (!job?.id || !job?.title) return Response.json({ error: "Mancano i dati dell'offerta" }, { status: 400 });
  const { Tracking } = await core();
  const tracking = await new Tracking().load();
  try {
    const item = tracking.set(job, { status, note });
    await tracking.save();
    return Response.json(item);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

/** Smette di seguire un'offerta. ?id=<id dell'offerta> */
export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get('id');
  const { Tracking } = await core();
  const tracking = await new Tracking().load();
  if (!tracking.remove(id)) return Response.json({ error: 'Offerta non seguita' }, { status: 404 });
  await tracking.save();
  return Response.json({ ok: true });
}

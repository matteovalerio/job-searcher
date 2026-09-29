import { core } from '../../../lib/core.js';
import { interviewData } from './prep.js';

export const dynamic = 'force-dynamic';

/** Preparazione al colloquio. ?job=<id> */
export async function GET(request) {
  const data = await interviewData(new URL(request.url).searchParams.get('job'));
  return Response.json(data, { status: data.status ?? 200 });
}

/** Data e dettagli del colloquio. Corpo: { job, interview: { at, mode, where, with } } (interview null: si toglie) */
export async function POST(request) {
  const { job: ref, interview } = await request.json().catch(() => ({}));
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const kit = kits.find(ref);
  const job = tracking.find(ref)?.job ?? kit?.job;
  if (!job) return Response.json({ error: 'Offerta non trovata' }, { status: 404 });
  try {
    tracking.setInterview(job, interview);
    await tracking.save();
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  const data = await interviewData(ref);
  return Response.json(data, { status: data.status ?? 200 });
}

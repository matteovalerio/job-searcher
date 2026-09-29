import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Il colloquio nel calendario, con un avviso un'ora prima. ?job=<id> */
export async function GET(request) {
  const ref = new URL(request.url).searchParams.get('job');
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const kit = kits.find(ref);
  const item = kit && tracking.get(kit.job.id);
  if (!item?.interview?.at) return Response.json({ error: 'Nessun colloquio in programma' }, { status: 404 });
  return new Response(c.interviewIcs(kit, item.interview), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="colloquio.ics"',
    },
  });
}

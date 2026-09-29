import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Promemoria da aggiungere al calendario: "controlla le date di …". ?id=<evento> */
export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  const { upcomingEvents, reminderIcs } = await core();
  const event = upcomingEvents().find((e) => e.id === id);
  if (!event) return Response.json({ error: 'Evento non trovato' }, { status: 404 });
  return new Response(reminderIcs(event), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${event.id}.ics"`,
    },
  });
}

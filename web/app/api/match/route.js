import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Prompt per claude.ai con il confronto tra candidato e offerte migliori. Corpo: { profile, top? } */
export async function POST(request) {
  const { profile, top = 15 } = await request.json().catch(() => ({}));
  const { loadProfile, loadLastResults, slugify, Tracking, HIDDEN_STATUSES, pickJobs, buildMatchPrompt } = await core();
  try {
    const last = await loadLastResults(slugify(profile));
    if (!last) throw new Error('Nessuna ricerca salvata per questo profilo: avviane una prima.');
    const tracking = await new Tracking().load();
    const jobs = pickJobs(last, { top, hidden: (job) => HIDDEN_STATUSES.includes(tracking.get(job.id)?.status) });
    return Response.json({
      prompt: buildMatchPrompt({ profile: await loadProfile(profile), jobs }),
      count: jobs.length,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

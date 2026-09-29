import { core, currentPlan } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await currentPlan());
}

/** Cambia gli obiettivi. Corpo: { goals: { applications, spontaneous } } */
export async function PUT(request) {
  const { goals } = await request.json().catch(() => ({}));
  const { savePlan } = await core();
  try {
    await savePlan({ goals });
    return Response.json(await currentPlan());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

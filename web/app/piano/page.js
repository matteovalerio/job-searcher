import { currentPlan } from '../../lib/core.js';
import PlanView from './PlanView.js';

export const dynamic = 'force-dynamic';

export default async function Piano() {
  return <PlanView initialPlan={await currentPlan()} />;
}

import { core } from '../../lib/core.js';
import TrackingBoard from './TrackingBoard.js';

export const dynamic = 'force-dynamic';

export default async function Candidature() {
  const { STATUSES, Tracking } = await core();
  const tracking = await new Tracking().load();
  return <TrackingBoard initialItems={tracking.list()} statuses={STATUSES} />;
}

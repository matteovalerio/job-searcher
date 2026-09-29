import { core } from '../../lib/core.js';
import TrackingBoard from './TrackingBoard.js';

export const dynamic = 'force-dynamic';

export default async function Candidature() {
  const { STATUSES, loadTrackingAndKits } = await core();
  const { tracking, kits } = await loadTrackingAndKits();
  return <TrackingBoard initialItems={tracking.list()} statuses={STATUSES} kitIds={kits.ids()} />;
}

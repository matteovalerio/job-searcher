import { eventsForActiveProfile } from '../../lib/events.js';
import EventsView from './EventsView.js';

export const dynamic = 'force-dynamic';

export default async function Eventi() {
  return <EventsView {...(await eventsForActiveProfile())} />;
}

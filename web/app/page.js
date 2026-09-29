import Link from 'next/link';
import { activeProfileId } from '../lib/active-profile.js';
import { core, resultsForPage } from '../lib/core.js';
import ResultsView from './ResultsView.js';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const { STATUSES, listProfiles } = await core();
  const profiles = await listProfiles();
  if (!profiles.length) {
    return (
      <div className="page">
        <h1>Offerte</h1>
        <div className="empty">
          Nessun profilo ancora. <Link href="/profili/nuovo">Crea il primo profilo</Link> per iniziare a cercare.
        </div>
      </div>
    );
  }
  const selected = await activeProfileId(profiles, params.profile);
  const profile = profiles.find((p) => p.id === selected);
  const results = await resultsForPage(selected);
  return (
    <ResultsView
      key={selected}
      profile={{ id: profile.id, name: profile.name, description: profile.description }}
      initialResults={results}
      statuses={STATUSES}
    />
  );
}

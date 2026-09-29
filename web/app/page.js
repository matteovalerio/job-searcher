import { core, resultsForPage } from '../lib/core.js';
import ResultsView from './ResultsView.js';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const { STATUSES, listProfiles } = await core();
  const profiles = await listProfiles();
  if (!profiles.length) {
    return (
      <div className="card empty">
        Nessun profilo. Creane uno dalla riga di comando con <code>node src/cli.js profile new</code> oppure{' '}
        <code>profile prompt</code> / <code>profile import</code>.
      </div>
    );
  }
  const selected = profiles.find((p) => p.id === params.profile)?.id ?? profiles[0].id;
  const results = await resultsForPage(selected);
  return (
    <ResultsView
      key={selected}
      profiles={profiles.map(({ id, name, description }) => ({ id, name, description }))}
      selected={selected}
      initialResults={results}
      statuses={STATUSES}
    />
  );
}

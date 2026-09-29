import Link from 'next/link';
import { core } from '../../lib/core.js';

export const dynamic = 'force-dynamic';

const describeTargets = (targets) =>
  targets
    .map((t) =>
      t.type === 'remote'
        ? 'full remote'
        : `${(t.places ?? [t.place]).filter(Boolean).join(', ')} (+${t.radiusKm ?? 30} km)`,
    )
    .join(' · ');

export default async function Profili() {
  const { listProfiles } = await core();
  const profiles = await listProfiles();
  return (
    <div className="stack">
      <div className="row">
        <h1>Profili</h1>
        <span className="spacer" />
        <Link href="/profili/nuovo" className="button">
          Nuovo profilo
        </Link>
      </div>
      {profiles.map((p) => (
        <div key={p.id} className="card">
          <div className="row">
            <strong>{p.name ?? p.id}</strong>
            <code className="muted small">{p.id}</code>
            <span className="spacer" />
            <Link href={`/?profile=${p.id}`}>Offerte</Link>
            <Link href={`/profili/${p.id}`}>Modifica</Link>
          </div>
          {p.description && <p className="meta">{p.description}</p>}
          <p className="meta">{describeTargets(p.targets)}</p>
        </div>
      ))}
    </div>
  );
}

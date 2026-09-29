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
      <h1>Profili</h1>
      <p className="muted small">
        Per crearne uno nuovo usa la riga di comando: <code>node src/cli.js profile new --cv cv.pdf</code>, oppure{' '}
        <code>profile prompt</code> e <code>profile import</code> per farlo scrivere a Claude.
      </p>
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

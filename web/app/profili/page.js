import Link from 'next/link';
import { core } from '../../lib/core.js';
import { PlusIcon } from '../icons.js';

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
    <div className="page">
      <header className="page-header">
        <div className="intro">
          <h1>Profili</h1>
          <p>Ogni profilo dice cosa cercare e dove. Quello attivo si sceglie nella barra laterale.</p>
        </div>
        <Link href="/profili/nuovo" className="button primary">
          <PlusIcon />
          Nuovo profilo
        </Link>
      </header>
      {!profiles.length && <div className="empty">Nessun profilo ancora: creane uno.</div>}
      <div className="profile-list">
        {profiles.map((p) => (
          <div key={p.id} className="card profile-item">
            <div className="row">
              <strong>{p.name ?? p.id}</strong>
              <code className="faint small">{p.id}</code>
              <span className="spacer" />
              <Link href={`/?profile=${p.id}`} className="button small">
                Offerte
              </Link>
              <Link href={`/profili/${p.id}`} className="button small">
                Modifica
              </Link>
            </div>
            {p.description && <p className="muted small">{p.description}</p>}
            <p className="faint small">{describeTargets(p.targets)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

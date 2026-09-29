import { notFound } from 'next/navigation';
import { core } from '../../../lib/core.js';
import ProfileEditor from './ProfileEditor.js';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({ params }) {
  const { id } = await params;
  const { loadProfile } = await core();
  let profile;
  try {
    profile = await loadProfile(id);
  } catch {
    notFound();
  }
  return <ProfileEditor id={id} initialText={JSON.stringify(profile, null, 2)} />;
}

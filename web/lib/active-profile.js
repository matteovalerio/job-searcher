import { cookies } from 'next/headers';

/** Nome del cookie con il profilo attivo (lo scrive la barra laterale). */
export const PROFILE_COOKIE = 'job-searcher-profile';

/** Profilo attivo: quello chiesto nell'indirizzo, altrimenti l'ultimo scelto, altrimenti il primo. */
export async function activeProfileId(profiles, requested) {
  const remembered = (await cookies()).get(PROFILE_COOKIE)?.value;
  return (
    profiles.find((p) => p.id === requested)?.id ?? profiles.find((p) => p.id === remembered)?.id ?? profiles[0]?.id
  );
}

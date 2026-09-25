import { request } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

// API gratuita con chiave: https://jooble.org/api/about. Aggrega molti portali italiani.
// Jooble accetta solo alcuni raggi (km).
const RADII = [0, 4, 8, 16, 26, 40, 80];

export function parse(data) {
  return (data.jobs ?? []).map((j) =>
    makeJob('jooble', {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.link,
      postedAt: j.updated,
      description: j.snippet,
      salary: j.salary,
      tags: [j.type, j.source],
    }),
  );
}

export default {
  name: 'jooble',
  label: 'Jooble',
  supports: ['area'],
  env: ['JOOBLE_API_KEY'],
  async search({ keywords, target, maxPages = 2, warn }) {
    const radius = RADII.find((r) => r >= (target.radiusKm ?? 30)) ?? 80;
    return eachQuery(
      keywords,
      async (keyword) => {
        const jobs = [];
        for (let page = 1; page <= maxPages; page++) {
          // Alcune chiavi funzionano solo col dominio del paese (es. JOOBLE_HOST=it.jooble.org).
          const host = process.env.JOOBLE_HOST || 'jooble.org';
          const res = await request(`https://${host}/api/${process.env.JOOBLE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keywords: keyword,
              location: target.place,
              radius: String(radius),
              page: String(page),
            }),
          });
          const found = parse(await res.json());
          jobs.push(...found);
          if (found.length < 20) break;
        }
        return jobs;
      },
      warn,
    );
  },
};

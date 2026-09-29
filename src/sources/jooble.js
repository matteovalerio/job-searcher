import { request } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';
import { expectList } from './shape.js';

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
    // Alcune chiavi funzionano solo col dominio del paese: se jooble.org non trova nulla si prova it.jooble.org
    // (o JOOBLE_HOST, se indicato, che ha la precedenza).
    const hosts = process.env.JOOBLE_HOST
      ? [process.env.JOOBLE_HOST]
      : ['jooble.org', `${(target.country ?? 'it').toLowerCase()}.jooble.org`];
    const fetchPage = async (host, keyword, page) => {
      const res = await request(`https://${host}/api/${process.env.JOOBLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: keyword, location: target.place, radius: String(radius), page: String(page) }),
      });
      return parse(expectList(await res.json(), ['jobs']));
    };
    return eachQuery(
      keywords,
      async (keyword) => {
        let host = hosts[0];
        let first = await fetchPage(host, keyword, 1);
        for (const other of hosts.slice(1)) {
          if (first.length) break;
          try {
            first = await fetchPage(other, keyword, 1);
            host = other;
          } catch {
            // il dominio del paese non accetta la chiave: si resta sul primo
          }
        }
        const jobs = [...first];
        for (let page = 2; page <= maxPages && jobs.length >= (page - 1) * 20; page++) {
          jobs.push(...(await fetchPage(host, keyword, page)));
        }
        return jobs;
      },
      warn,
    );
  },
};

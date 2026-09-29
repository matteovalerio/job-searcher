import { getJson, request } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';
import { expectList } from './shape.js';

/*
 * Piattaforme di selezione del personale (ATS) usate da molte aziende, anche dai grandi editori
 * scientifici. Hanno interfacce pubbliche e stabili: basta sapere il nome dell'azienda sulla piattaforma,
 * che si legge nell'indirizzo della sua pagina delle offerte.
 *
 *   workday:          https://<azienda>.wd3.myworkdayjobs.com/<sito>       -> { "url": "<quell'indirizzo>" }
 *   greenhouse:       https://boards.greenhouse.io/<azienda>               -> { "board": "<azienda>" }
 *   lever:            https://jobs.lever.co/<azienda>                      -> { "company": "<azienda>" }
 *   smartrecruiters:  https://jobs.smartrecruiters.com/<Azienda>           -> { "company": "<Azienda>" }
 *
 * "employer" è il nome da mostrare nei risultati.
 */

const REMOTE = /\bremote\b|da remoto|home[\s-]based|telelavoro/i;

// --- Workday ---

/** Da "https://acme.wd3.myworkdayjobs.com/en-US/Careers" all'indirizzo dell'interfaccia delle offerte. */
export function workdayApi(url) {
  const u = new URL(url);
  const tenant = u.host.split('.')[0];
  const site = u.pathname.split('/').filter((p) => p && !/^[a-z]{2}-[A-Z]{2}$/.test(p))[0];
  if (!site) throw new Error(`Indirizzo Workday incompleto: ${url} (serve anche il nome del sito dopo il dominio)`);
  return { api: `${u.origin}/wday/cxs/${tenant}/${site}/jobs`, base: `${u.origin}/${site}` };
}

/** "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago" -> data ISO (approssimata). */
export function workdayDate(postedOn, now = Date.now()) {
  const text = String(postedOn ?? '').toLowerCase();
  let days = null;
  if (/today|oggi/.test(text)) days = 0;
  else if (/yesterday|ieri/.test(text)) days = 1;
  else if (/(\d+)\+?\s*(days?|giorni)/.test(text)) days = Number(text.match(/(\d+)/)[1]);
  return days === null ? null : new Date(now - days * 86400000).toISOString();
}

export function parseWorkday(data, { base, employer, source }) {
  return (data.jobPostings ?? [])
    .filter((j) => j.title && j.externalPath)
    .map((j) =>
      makeJob(source ?? 'workday', {
        id: j.externalPath,
        title: j.title,
        company: employer,
        location: j.locationsText,
        url: `${base}${j.externalPath}`,
        postedAt: workdayDate(j.postedOn),
        tags: j.bulletFields,
        remote: REMOTE.test(j.locationsText ?? '') || REMOTE.test(j.remoteType ?? '') ? true : null,
      }),
    );
}

export function createWorkdaySource({ name, label, url, employer, supports = ['area', 'remote'] }) {
  if (!url) throw new Error(`La fonte workday "${name}" richiede "url"`);
  const { api, base } = workdayApi(url);
  return {
    name,
    label: label ?? name,
    supports,
    async search({ keywords, warn }) {
      return eachQuery(
        keywords,
        async (keyword) => {
          const res = await request(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: keyword }),
          });
          return parseWorkday(expectList(await res.json(), ['jobPostings']), {
            base,
            employer: employer ?? label ?? name,
            source: name,
          });
        },
        warn,
      );
    },
  };
}

// --- Greenhouse ---

export function parseGreenhouse(data, { employer, source }) {
  return (data.jobs ?? []).map((j) =>
    makeJob(source ?? 'greenhouse', {
      id: j.id,
      title: j.title,
      company: employer,
      location: j.location?.name,
      url: j.absolute_url,
      postedAt: j.first_published ?? j.updated_at,
      description: j.content ? j.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '',
      remote: REMOTE.test(j.location?.name ?? '') ? true : null,
    }),
  );
}

// --- Lever ---

export function parseLever(data, { employer, source }) {
  return (Array.isArray(data) ? data : []).map((j) =>
    makeJob(source ?? 'lever', {
      id: j.id,
      title: j.text,
      company: employer,
      location: j.categories?.location ?? j.categories?.allLocations?.join(', '),
      url: j.hostedUrl,
      postedAt: j.createdAt,
      description: j.descriptionPlain ?? j.description,
      tags: [j.categories?.commitment, j.categories?.team],
      remote: j.workplaceType === 'remote' || REMOTE.test(j.categories?.location ?? '') ? true : null,
    }),
  );
}

// --- SmartRecruiters ---

export function parseSmartRecruiters(data, { company, employer, source }) {
  return (data.content ?? []).map((j) =>
    makeJob(source ?? 'smartrecruiters', {
      id: j.id,
      title: j.name,
      company: j.company?.name ?? employer,
      location: [j.location?.city, j.location?.country?.toUpperCase?.()].filter(Boolean).join(', '),
      url: `https://jobs.smartrecruiters.com/${company}/${j.id}`,
      postedAt: j.releasedDate,
      tags: [j.typeOfEmployment?.label, j.department?.label],
      remote: j.location?.remote || j.location?.fullyRemote ? true : null,
    }),
  );
}

/** Greenhouse e Lever restituiscono tutte le offerte in una volta: si scaricano una volta e si filtrano in locale. */
function createListSource({ name, label, supports = ['area', 'remote'], fetchAll }) {
  let cached;
  return {
    name,
    label: label ?? name,
    supports,
    usesKeywords: false,
    async search() {
      cached ??= fetchAll().catch((err) => {
        cached = undefined;
        throw err;
      });
      return cached;
    },
  };
}

export function createGreenhouseSource({ name, label, board, employer, supports }) {
  if (!board) throw new Error(`La fonte greenhouse "${name}" richiede "board"`);
  return createListSource({
    name,
    label,
    supports,
    fetchAll: async () =>
      parseGreenhouse(
        expectList(
          await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`),
          ['jobs'],
        ),
        {
          employer: employer ?? label ?? name,
          source: name,
        },
      ),
  });
}

export function createLeverSource({ name, label, company, employer, region, supports }) {
  if (!company) throw new Error(`La fonte lever "${name}" richiede "company"`);
  const host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
  return createListSource({
    name,
    label,
    supports,
    fetchAll: async () =>
      parseLever(
        expectList(await getJson(`https://${host}/v0/postings/${encodeURIComponent(company)}?mode=json`), ['']),
        {
          employer: employer ?? label ?? name,
          source: name,
        },
      ),
  });
}

export function createSmartRecruitersSource({ name, label, company, employer, supports = ['area', 'remote'] }) {
  if (!company) throw new Error(`La fonte smartrecruiters "${name}" richiede "company"`);
  return {
    name,
    label: label ?? name,
    supports,
    async search({ keywords, warn }) {
      return eachQuery(
        keywords,
        async (keyword) =>
          parseSmartRecruiters(
            expectList(
              await getJson(
                `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?${new URLSearchParams({ q: keyword, limit: '100' })}`,
              ),
              ['content'],
            ),
            { company, employer: employer ?? label ?? name, source: name },
          ),
        warn,
      );
    },
  };
}

const COLUMNS = ['target', 'isNew', 'score', 'title', 'company', 'location', 'postedAt', 'source', 'url', 'salary'];
// Informazioni ricavate dal testo (vedi src/extract.js).
const INFO = {
  livello: (i) => i?.seniority,
  anniRichiesti: (i) => i?.yearsRequired,
  contratto: (i) => i?.contracts?.join(' '),
  orario: (i) => i?.workTime,
  stipendioAnnuoMin: (i) => i?.salary?.annualMin,
  stipendioAnnuoMax: (i) => i?.salary?.annualMax,
  valuta: (i) => i?.salary?.currency,
};

const cell = (value) => {
  const s = String(value ?? '');
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderCsv(results) {
  const rows = [[...COLUMNS, ...Object.keys(INFO)].join(',')];
  for (const { target, jobs } of results) {
    for (const job of jobs) {
      const base = COLUMNS.map((col) => cell(col === 'target' ? target.label : job[col]));
      rows.push([...base, ...Object.values(INFO).map((get) => cell(get(job.info)))].join(','));
    }
  }
  return `${rows.join('\n')}\n`;
}

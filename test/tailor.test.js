import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTailorPrompt, emphasisFor } from '../src/tailor.js';

test('libri per bambini: si valorizza il processo editoriale, non i contenuti scientifici', () => {
  const e = emphasisFor({ specialties: ['bambini'] });
  assert.deepEqual(e.specialties, [{ id: 'bambini', label: 'Libri per bambini e ragazzi' }]);
  assert.ok(e.focus.some((f) => /InDesign/.test(f)));
  assert.ok(e.focus.some((f) => /illustratori/.test(f)));
  assert.ok(e.downplay.some((d) => /scientifici/.test(d)));
});

test("specializzazione ricavata dal testo dell'annuncio; studio editoriale = versatilità", () => {
  const e = emphasisFor({ text: 'Redattore per riviste scientifiche, peer review', kind: 'studio-editoriale' });
  assert.deepEqual(
    e.specialties.map((s) => s.id),
    ['scientifica', 'riviste'],
  );
  assert.match(e.focus[0], /versatilità/);
  assert.deepEqual(emphasisFor({ text: 'Magazziniere' }).specialties, []);
});

test('prompt per una candidatura spontanea', () => {
  const publisher = {
    name: 'Edizioni Esempio',
    kind: 'casa-editrice',
    city: 'Padova',
    website: 'https://www.edizioniesempio.it/',
    description: 'Albi illustrati per bambini',
  };
  const prompt = buildTailorPrompt({
    cvText: 'Redattrice, 5 anni in casa editrice scientifica',
    target: { type: 'publisher', publisher },
    emphasis: emphasisFor({ specialties: ['bambini'] }),
  });
  assert.match(prompt, /<cv>\nRedattrice, 5 anni/);
  assert.match(prompt, /candidatura spontanea/);
  assert.match(prompt, /Edizioni Esempio \(casa editrice\)/);
  assert.match(prompt, /COSA VALORIZZARE\n- gestione del processo editoriale/);
  assert.match(prompt, /COSA METTERE IN SECONDO PIANO/);
  assert.match(prompt, /Non inventare nulla/);
  assert.match(prompt, /email di candidatura spontanea/);
});

test("prompt per un'offerta, senza CV salvato", () => {
  const job = { title: 'Editor', company: 'Great Books', url: 'https://x/1', description: 'We publish novels.' };
  const prompt = buildTailorPrompt({
    target: { type: 'job', job },
    emphasis: emphasisFor({ text: job.description }),
  });
  assert.match(prompt, /allegato a questo messaggio/);
  assert.match(prompt, /- Ruolo: Editor/);
  assert.match(prompt, /We publish novels/);
  assert.match(prompt, /Lingua: quella dell'annuncio/);
  assert.match(prompt, /Narrativa e letteratura/);
});

test('azienda di un settore affine: focus del settore, perché è affine e ruolo da proporre', () => {
  const publisher = {
    name: 'Idea Comunicazione',
    kind: 'agenzia-comunicazione',
    pitch: 'correttore di bozze e impaginatore',
  };
  const emphasis = emphasisFor({ kind: publisher.kind });
  assert.ok(emphasis.focus.some((f) => /InDesign/.test(f)));
  const prompt = buildTailorPrompt({ cvText: 'CV', target: { type: 'publisher', publisher }, emphasis });
  assert.match(prompt, /\(agenzia di comunicazione\)/);
  assert.match(prompt, /Perché è affine al mio profilo: brochure, cataloghi, libretti per eventi e sagre/);
  assert.match(prompt, /Ruolo che vorrei proporre: correttore di bozze e impaginatore/);
  assert.match(prompt, /Non è una casa editrice/);
  const publisherPrompt = buildTailorPrompt({
    cvText: 'CV',
    target: { type: 'publisher', publisher: { name: 'Edizioni X', kind: 'casa-editrice' } },
    emphasis: emphasisFor({ kind: 'casa-editrice' }),
  });
  assert.doesNotMatch(publisherPrompt, /Non è una casa editrice|Perché è affine/);
});

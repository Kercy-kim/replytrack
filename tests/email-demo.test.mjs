import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDemo } from '../src/email-demo.mjs';
import { analysisValidationErrors, validateDraft } from '../src/domain.mjs';
import { demoAnalysis, demoActions, demoDraft } from '../src/demo.mjs';
import { validateActions } from '../src/next-actions.mjs';
import { validateEmailExplanation } from '../src/email.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { renderEmailDemo } from '../public/email-demo.js';

test('email presentation uses grounded analysis, action and explanation contracts', () => {
  const c = createEmailDemo();
  assert.equal(c.mode, 'demo'); assert.equal(c.channel, 'email');
  assert.deepEqual(analysisValidationErrors(demoAnalysis(c), c.messages), []);
  validateActions(demoActions(c), c);
  validateEmailExplanation(c.emailExplanation, c.messages);
  validateDraft(demoDraft(c, 'followup', c.questions.map(q => q.id)), c);
  assert.deepEqual(c.questions.map(q => q.status), ['answered', 'partial']);
});

test('email example never calls AI and preserves question IDs and actual-result separation', async t => {
  const store = new CaseStore(':memory:'); t.after(() => store.close());
  const svc = new ReplyTrack(store, { structured: () => { throw Error('Presentation must not call AI'); } });
  let c = svc.demo({ scenario: 'email' }); const ids = c.questions.map(q => q.id);
  c = await svc.explainEmail(c.id, c.version);
  c = await svc.actions(c.id, c.version);
  c = await svc.draft(c.id, { version: c.version, kind: 'followup', questionIds: [ids[1]], language: 'en' });
  assert.equal(c.drafts.followup.language, 'en');
  c = svc.advance(c.id, c.version);
  assert.deepEqual(c.questions.map(q => q.id), ids);
  assert.deepEqual(c.questions.map(q => q.status), ['answered', 'answered']);
  assert.equal(c.analysis.comparison.questions.length, 1);
  assert.equal(c.nextActions.items[0].state, 'reported_done');
  assert.equal(c.nextActions.items[0].completedAt, null);
  assert(c.promises.every(p => !p.confirmedAt));
  assert.equal(c.emailExplanation.messageCount, 3);
  assert.throws(() => svc.advance(c.id, c.version));
});

test('presentation discloses prepared data at every stage and does not claim recovery', () => {
  const c = createEmailDemo();
  const helpers = { esc: s => String(s).replaceAll('<', '&lt;'), button: () => '', badge: () => '', comparisonPanel: () => '' };
  for (const step of [0, 1, 2, 3]) assert.match(renderEmailDemo(c, step, helpers), /준비된 결과 · AI API 호출 없음/);
  assert.match(renderEmailDemo(c, 3, helpers), /계정은 아직 복구되지 않았어요/);
});

import assert from 'node:assert/strict';
import { emailCases } from '../evals/email-cases.mjs';
import { compareAnalysis } from './analysis-changes.mjs';
import { analysisValidationErrors, validateDraft } from './domain.mjs';
import { validateActions } from './next-actions.mjs';
import { validateEmailExplanation } from './email.mjs';

// Only this public synthetic fixture may be packaged, never an arbitrary user case.
export function presentationData(report, provenance) {
  const fixture = emailCases[0], { before, after } = report;
  assert(report.passed && report.synthetic === true && report.fixture === fixture.id);
  assert.equal(report.mode, 'live OpenAI Responses API');
  const normalized = text => text.replace(/\s+/g, ' ').trim();
  assert.deepEqual(before.messages.map(m => normalized(m.text)), [fixture.customer, fixture.agent]);
  assert.deepEqual(after.messages.map(m => normalized(m.text)), [fixture.customer, fixture.agent, fixture.reply]);
  assert.deepEqual(after.questions.map(q => q.id), before.questions.map(q => q.id));
  assert.deepEqual(before.questions.map(q => q.status).sort(), ['answered', 'partial']);
  assert(after.questions.every(q => q.status === 'answered'));
  for (const c of [before, after]) {
    assert.deepEqual(analysisValidationErrors(c, c.messages), []);
    validateActions(c.nextActions, c); validateEmailExplanation(c.emailExplanation, c.messages);
    assert(c.promises.every(p => !p.confirmedAt));
    assert(c.nextActions.items.every(i => !i.completedAt));
  }
  validateDraft(before.drafts.followup, before);
  assert.equal(before.nextActions.items[0].state, 'requested');
  assert.equal(after.nextActions.items[0].state, 'reported_done');
  assert.deepEqual(compareAnalysis({ ...before, messages: after.messages }, after.questions, after.promises, after.analysis.comparison.at), after.analysis.comparison);
  assert(report.calls.length && report.calls.every(c => c.model === 'gpt-5-mini-2025-08-07'));
  const pick = c => ({ messages: c.messages, questions: c.questions, promises: c.promises, emailExplanation: c.emailExplanation, nextActions: c.nextActions, drafts: c.drafts, comparison: c.analysis.comparison });
  return { schemaVersion: 1, provenance: { ...provenance, fixture: report.fixture, synthetic: true, model: report.calls[0].model, recordedAt: report.finishedAt, apiCalls: report.calls.length, operationMs: report.steps.reduce((n, s) => n + s.ms, 0), sourceHashes: report.sourceHashes }, before: pick(before), after: pick(after) };
}

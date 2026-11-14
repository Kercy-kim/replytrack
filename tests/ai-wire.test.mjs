import test from 'node:test';
import assert from 'node:assert/strict';
import { compactReferences } from '../src/ai-wire.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { analysisSchemaFor, draftSchemaFor } from '../src/schema.mjs';
import { analysisContext } from '../src/service.mjs';
import { createDemo } from '../src/demo.mjs';
import { validateDraft } from '../src/domain.mjs';

test('wire references round trip across messages, existing questions, promises and constrained schemas', () => {
  const record = createDemo(), data = analysisContext(record), before = structuredClone(data);
  const schema = analysisSchemaFor(record.messages), wire = compactReferences(data, schema);
  assert(JSON.stringify(wire.data).length < JSON.stringify(data).length);
  assert.deepEqual(wire.decode(wire.data), data);
  assert.deepEqual(data, before);
  for (const [i, m] of wire.data.messages.entries()) { assert.match(m.id, /^_r\d+$/); assert.equal(m.text, record.messages[i].text); assert.equal(m.sentAt, record.messages[i].sentAt); }
  const question = wire.schema.properties.questions.items.properties;
  assert.deepEqual(question.source.properties.messageId.enum, wire.data.messages.filter(m => m.role === 'customer').map(m => m.id));
  assert.deepEqual(question.evidence.items.properties.messageId.enum, wire.data.messages.filter(m => m.role === 'agent').map(m => m.id));
  assert.deepEqual(schema.properties.questions.items.properties.source.properties.messageId.enum, record.messages.filter(m => m.role === 'customer').map(m => m.id));
});

test('literal references and quoted IDs are never rewritten; aliases cannot collide with source text', () => {
  const record = createDemo(); record.messages[0].text += ` _r1 _r2 ${record.messages[0].id}`;
  const data = analysisContext(record), wire = compactReferences(data, analysisSchemaFor(record.messages));
  assert(!['_r1', '_r2'].includes(wire.data.messages[0].id));
  assert.equal(wire.data.messages[0].text, record.messages[0].text);
  assert.deepEqual(wire.decode({ quote: '_r1', text: record.messages[0].id, id: 'new-q-1', source: { messageId: '_r99999', quote: '_r1' } }), { quote: '_r1', text: record.messages[0].id, id: 'new-q-1', source: { messageId: '_r99999', quote: '_r1' } });
});

test('wire-only references in draft prose still trigger the existing internal-reference guard', () => {
  const record = createDemo(), wire = compactReferences({ messages: record.messages }, draftSchemaFor(record.messages));
  const alias = wire.data.messages[0].id;
  const draft = wire.decode({ body: `이전 문의(${alias})를 확인해 주세요.`, sourceMessageIds: [alias] });
  assert.equal(draft.sourceMessageIds[0], record.messages[0].id);
  assert.throws(() => validateDraft(draft, record), { code: 'DRAFT_REFERENCE' });
  assert.throws(() => validateDraft({ body: '문의(_r99999)를 확인해 주세요.', sourceMessageIds: [record.messages[0].id] }, record), { code: 'DRAFT_REFERENCE' });
  record.messages[0].text += ' 접수번호는 _r99999입니다.';
  assert.equal(validateDraft({ body: '접수번호 _r99999를 확인해 주세요.', sourceMessageIds: [record.messages[0].id] }, record).sourceMessageIds[0], record.messages[0].id);
});

test('generated explanations restore canonical references and repair feedback maps to the next request', () => {
  const record = createDemo(), data = analysisContext(record), schema = analysisSchemaFor(record.messages);
  const first = compactReferences(data, schema), alias = first.data.messages[0].id, id = record.messages[0].id;
  const output = first.decode({ summary: `요청(${alias})`, questions: [{ reason: `근거 ${alias}`, followUp: `확인 ${alias}` }], feedback: `검토 ${alias}`, quote: alias });
  assert.equal(output.summary, `요청(${id})`); assert.equal(output.questions[0].reason, `근거 ${id}`);
  assert.equal(output.questions[0].followUp, `확인 ${id}`); assert.equal(output.feedback, `검토 ${id}`);
  assert.equal(output.quote, alias);
  const second = compactReferences({ ...data, revisionFeedback: output.feedback }, schema);
  assert.equal(second.data.revisionFeedback, `검토 ${second.data.messages[0].id}`);
  assert.deepEqual(second.data.messages.map(m => m.text), record.messages.map(m => m.text));
});

test('concurrent API calls decode using their own request mapping and expose canonical IDs to the service', async () => {
  const records = [createDemo(), createDemo()], payloads = [];
  const client = new OpenAIClient({ apiKey: 'sk-test-not-a-real-credential', fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body), data = JSON.parse(payload.input[0].content[0].text); payloads.push(payload);
    await new Promise(resolve => setTimeout(resolve, payloads.length === 1 ? 10 : 0));
    return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ body: '문의 내용 확인 부탁드립니다.', sourceMessageIds: [data.messages[0].id] }) }] }] }) };
  } });
  const results = await Promise.all(records.map(r => client.structured({ name: 'draft', instructions: 'test', schema: draftSchemaFor(r.messages), data: { messages: r.messages } })));
  assert.notEqual(records[0].messages[0].id, records[1].messages[0].id);
  for (const [i, result] of results.entries()) assert.equal(result.data.sourceMessageIds[0], records[i].messages[0].id);
  assert(payloads.every(p => p.store === false && p.max_output_tokens === 6500));
});

test('analysis input keeps all original messages, source identity and prior commitments without duplicated AI prose', () => {
  const record = createDemo();
  record.questions[0].status = record.questions[0].manualStatus = 'answered';
  record.questions[0].aiStatus = 'waiting';
  const original = structuredClone(record), data = analysisContext(record);
  assert.deepEqual(data.messages, record.messages);
  assert.deepEqual(data.existingQuestions.map(q => q.source), record.questions.map(q => q.source));
  for (const q of data.existingQuestions) assert.deepEqual(Object.keys(q).sort(), ['evidence', 'id', 'source', 'status', 'title']);
  assert.deepEqual(data.existingQuestions.map(q => q.status), record.questions.map(q => q.aiStatus ?? q.status));
  for (const p of data.existingPromises) assert.deepEqual(Object.keys(p).sort(), ['dueText', 'evidence', 'id', 'questionIds', 'state', 'title']);
  assert.deepEqual(record, original);
  assert.equal(data.existingQuestions[0].status, 'waiting');
  assert.equal(record.questions[0].manualStatus, 'answered');
});

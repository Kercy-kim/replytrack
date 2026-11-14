import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { extensionOrigin } from '../src/extension-access.mjs';
import { ReplyTrackApi } from '../extension/api.js';
import { readSelection, selectionPayload } from '../extension/selection.js';
import { ExtensionFixtureAI, fixtureText } from './helpers/extension-fixture.mjs';

test('selection import reads only highlighted text, excludes password fields and strips URL credentials', () => {
  const run = (element, selected = '') => vm.runInNewContext(`(${readSelection.toString()})()`, {
    document: { activeElement: element, title: '상담' }, window: { getSelection: () => ({ toString: () => selected }) }, location: { href: 'https://shop.example/support?token=private#secret' },
  });
  assert.equal(run(null, '선택한 대화').text, '선택한 대화');
  assert.equal(run({ tagName: 'TEXTAREA', value: '앞부분선택뒷부분', selectionStart: 3, selectionEnd: 5 }).text, '선택');
  assert.equal(run({ tagName: 'INPUT', type: 'password', value: 'secret', selectionStart: 0, selectionEnd: 6 }).text, '');
  const payload = selectionPayload('  나: 문의\n업체: 답변  ', '상담', 'https://user:pass@shop.example/a?token=private#secret');
  assert.deepEqual(payload, { text: '나: 문의\n업체: 답변', pageTitle: '상담', site: 'shop.example' });
  assert.throws(() => selectionPayload(' '), /먼저 드래그/);
  assert.throws(() => selectionPayload('가'.repeat(30001)), /30,000/);
  assert.equal(selectionPayload('대화', '', 'javascript:alert(1)').site, '');
});

test('extension transport: exact origin, preflight, live-case workflow, persisted failures and web compatibility', async () => {
  const ai = new ExtensionFixtureAI();
  const app = createApp({ store: new CaseStore(':memory:'), ai });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const extensionFetch = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: extensionOrigin } });
  const api = new ReplyTrackApi(base, extensionFetch);
  try {
    const preflight = await fetch(base + '/api/extract', { method: 'OPTIONS', headers: { Origin: extensionOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), extensionOrigin);
    for (const origin of ['null', 'https://evil.example', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', extensionOrigin + '.evil']) {
      const denied = await fetch(base + '/api/config', { headers: { Origin: origin } });
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    }
    const deniedHeader = await fetch(base + '/api/extract', { method: 'OPTIONS', headers: { Origin: extensionOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(deniedHeader.status, 403);
    await assert.rejects(() => api.request('/api/config', 'PUT', { apiKey: 'not-a-credential' }), { status: 403 });
    await assert.rejects(() => api.request('/api/demo', 'POST', {}), { status: 403 });
    await assert.rejects(() => api.request('/.env'), { status: 403 });
    assert.equal((await api.request('/api/config')).configured, true);
    const transcript = await api.request('/api/extract', 'POST', { text: fixtureText });
    assert.equal(ai.calls[0].data.text, fixtureText);
    let record = await api.request('/api/cases', 'POST', { title: '확장 상담', messages: transcript.messages });
    assert.equal(record.mode, 'live');
    ai.failAnalysis = true;
    await assert.rejects(() => api.request(`/api/cases/${record.id}/analyze`, 'POST', { version: record.version }), { status: 502 });
    assert.equal((await api.request(`/api/cases/${record.id}`)).messages.length, 2);
    ai.failAnalysis = false;
    record = await api.request(`/api/cases/${record.id}/analyze`, 'POST', { version: record.version });
    assert.deepEqual(record.questions.map(q => q.status), ['waiting', 'answered', 'unanswered']);
    const selected = [record.questions[2].id];
    record = await api.request(`/api/cases/${record.id}/drafts`, 'POST', { version: record.version, kind: 'followup', questionIds: selected });
    assert.match(record.drafts.followup.body, /배송비/);
    assert.doesNotMatch(record.drafts.followup.body, /견적을 언제/);
    await assert.rejects(() => api.request(`/api/cases/${record.id}/drafts`, 'POST', { version: record.version - 1, kind: 'followup', questionIds: selected }), { status: 409 });
    await assert.rejects(() => api.request(`/api/cases/${record.id}`, 'DELETE', { version: record.version }), { status: 403 });
    const web = await fetch(base + '/api/cases', { headers: { Origin: base } });
    assert.equal(web.status, 200); assert.equal((await web.json())[0].id, record.id);
    assert.equal((await fetch(base + '/?case=' + record.id)).status, 200);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});

test('extension API reports offline errors and preserves server conflict details', async () => {
  const offline = new ReplyTrackApi(undefined, async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => offline.request('/api/config'), /node server.mjs/);
  const conflict = new ReplyTrackApi(undefined, async () => new Response(JSON.stringify({ error: '상담이 변경됐습니다.' }), { status: 409 }));
  await assert.rejects(() => conflict.request('/api/cases/x/analyze', 'POST', { version: 1 }), { status: 409, message: '상담이 변경됐습니다.' });
});

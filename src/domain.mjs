import { randomUUID } from 'node:crypto';
import { assert, AppError } from './errors.mjs';
import { compareAnalysis } from './analysis-changes.mjs';

export const statuses = ['unanswered', 'partial', 'waiting', 'answered', 'review'];
export const statusNames = { unanswered: '미답변', partial: '부분 답변', waiting: '답변 대기', answered: '답변 받음', review: '확인 필요' };
export const uid = () => randomUUID();
export const cleanText = (value, max, name) => {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name}을(를) 1~${max}자로 입력해 주세요.`);
  return value.trim();
};
export function message(input) {
  assert(['customer', 'agent'].includes(input?.role), '발화자를 나 또는 고객센터로 선택해 주세요.');
  const text = cleanText(input.text, 6000, '메시지');
  let sentAt = null;
  if (input.sentAt) {
    assert(typeof input.sentAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(input.sentAt) && Number.isFinite(Date.parse(input.sentAt)), '상담 날짜를 확인해 주세요.');
    sentAt = new Date(input.sentAt).toISOString();
  }
  return { id: uid(), role: input.role, text, sentAt };
}
export function history(record, type, label, details = '') {
  const entry = { id: uid(), at: new Date().toISOString(), type, label, details };
  record.history.unshift(entry);
  record.history = record.history.slice(0, 150);
  return entry;
}
export function newCase(input, mode = 'live') {
  assert(Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= 60, '상담 메시지를 1~60개 등록해 주세요.');
  const messages = input.messages.map(message);
  assert(messages.some(m => m.role === 'customer'), '질문을 분석할 수 있도록 내 메시지를 포함해 주세요.');
  assert(messages.reduce((n, m) => n + m.text.length, 0) <= 40000, '상담은 총 40,000자까지 등록할 수 있습니다.');
  const now = new Date().toISOString();
  const record = {
    id: uid(), title: cleanText(input.title, 100, '상담 제목'), company: cleanText(input.company || '고객센터', 60, '업체명'), mode,
    createdAt: now, updatedAt: now, messages, questions: [], promises: [], history: [],
    summary: '', warnings: [], analyzedMessageCount: 0, drafts: {}, analysis: null,
  };
  history(record, 'created', '상담 기록을 만들었어요', `${messages.length}개 메시지 등록`);
  return record;
}
function validEvidence(ref, messages, role) {
  const m = messages.find(m => m.id === ref?.messageId && m.role === role);
  return !!m && typeof ref?.quote === 'string' && ref.quote.trim().length >= 2 && m.text.includes(ref.quote);
}
export function dueDate(dueText, sentAt) {
  if (!dueText) return null;
  let year, month, day;
  const absolute = dueText.match(/(20\d{2})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})/);
  if (absolute) [, year, month, day] = absolute.map(Number);
  else if (sentAt && Number.isFinite(Date.parse(sentAt))) {
    const base = new Date(Date.parse(sentAt) + 9 * 3600000);
    const relative = dueText.match(/오늘|내일|모레/);
    if (!relative) return null;
    base.setUTCDate(base.getUTCDate() + ({ 오늘: 0, 내일: 1, 모레: 2 })[relative[0]]);
    [year, month, day] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  } else return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function applyAnalysis(record, raw, meta = {}) {
  if (!raw || !Array.isArray(raw.questions) || !Array.isArray(raw.promises) || raw.questions.length > 40 || raw.promises.length > 40) throw new AppError(502, 'AI 분석 형식이 올바르지 않습니다. 기존 기록은 유지됩니다.', 'AI_FORMAT');
  const warnings = [], usedIds = new Set(), mapping = new Map();
  const oldQuestions = record.questions;
  const questions = [];
  for (const q of raw.questions) {
    if (!validEvidence(q.source, record.messages, 'customer')) { warnings.push('원문에 없는 질문 인용을 제외했습니다. 빠진 질문이 있는지 확인해 주세요.'); continue; }
    const old = oldQuestions.find(p => p.id === q.id) ?? oldQuestions.find(p => p.source.messageId === q.source.messageId && p.source.quote === q.source.quote);
    const id = old?.id ?? uid();
    if (usedIds.has(id)) continue;
    usedIds.add(id); mapping.set(q.id, id);
    const refs = Array.isArray(q.evidence) ? q.evidence : [];
    const evidence = refs.filter(e => validEvidence(e, record.messages, 'agent'));
    let status = statuses.includes(q.status) ? q.status : 'review';
    let reason = typeof q.reason === 'string' ? q.reason.slice(0, 1200) : '판단 이유를 확인해 주세요.';
    if (refs.length !== evidence.length || (['answered', 'waiting', 'partial'].includes(status) && !evidence.length)) {
      status = 'review'; reason = 'AI가 제시한 답변 근거를 원문에서 확인하지 못했습니다. 직접 확인해 주세요.';
      warnings.push('일부 답변 근거가 검증되지 않아 확인 필요로 표시했습니다.');
    }
    if (status === 'unanswered' && evidence.length) {
      status = 'review'; reason = '미답변 판정과 답변 근거가 함께 제시되어 일치하지 않습니다. 인용된 안내를 직접 확인해 주세요.';
      warnings.push('미답변 판정에 답변 근거가 있어 확인 필요로 표시했습니다.');
    }
    const title = typeof q.title === 'string' && q.title.trim() ? q.title.slice(0, 200) : q.source.quote.slice(0, 200);
    questions.push({
      id, title: old?.manualTitle ?? title, source: old?.source ?? q.source,
      status: old?.manualStatus ?? status, reason: old?.manualStatus ? '사용자가 직접 지정한 상태입니다. 새 AI 판단은 별도로 표시합니다.' : reason,
      evidence, followUp: typeof q.followUp === 'string' ? q.followUp.slice(0, 500) : '',
      aiStatus: status, aiReason: reason, manualStatus: old?.manualStatus ?? null, manualTitle: old?.manualTitle ?? null,
    });
  }
  for (const q of oldQuestions.filter(q => !usedIds.has(q.id))) {
    questions.push({ ...q, status: q.manualStatus ?? 'review', aiStatus: 'review', aiReason: '새 분석에서 이 질문이 누락됐습니다. 이전 기록과 함께 확인해 주세요.', reason: '새 분석에서 누락되어 이전 질문을 보존했습니다.' });
    warnings.push('누락된 기존 질문을 보존했습니다.');
  }
  if (!questions.length) throw new AppError(422, '원문에 연결할 질문을 찾지 못했습니다. 내 질문과 발화자를 확인한 뒤 다시 분석해 주세요.', 'NO_QUESTIONS');
  const promises = [];
  for (const p of raw.promises) {
    if (!validEvidence(p.evidence, record.messages, 'agent')) { warnings.push('원문에 없는 처리 약속을 제외했습니다.'); continue; }
    const old = record.promises.find(x => x.id === p.id) ?? record.promises.find(x => x.evidence.messageId === p.evidence.messageId && x.evidence.quote === p.evidence.quote);
    const id = old?.id ?? uid();
    if (promises.some(x => x.id === id)) continue;
    const dueText = typeof p.dueText === 'string' && p.evidence.quote.includes(p.dueText) ? p.dueText : '';
    const source = record.messages.find(m => m.id === p.evidence.messageId);
    // An omitted deadline preserves history; an explicit retraction in a newer reply clears it.
    // Older AI output/fixtures without this flag keep the previous behavior.
    const laterEvidence = !old || record.messages.indexOf(source) > record.messages.findIndex(m => m.id === old.evidence.messageId);
    const clearDeadline = p.deadlineCleared === true && p.dueText === '' && laterEvidence;
    if (p.deadlineCleared === true && !clearDeadline && old?.dueText) warnings.push('기한 철회의 새 원문 근거를 확인하지 못해 철회 판정을 적용하지 않았습니다.');
    promises.push({ id, title: typeof p.title === 'string' ? p.title.slice(0, 200) : '처리 내용 확인',
      questionIds: (Array.isArray(p.questionIds) ? p.questionIds : []).map(id => mapping.get(id) ?? id).filter(id => questions.some(q => q.id === id)),
      evidence: p.evidence, dueText: clearDeadline ? '' : dueText || old?.dueText || '', dueAt: clearDeadline ? null : dueText ? dueDate(dueText, source.sentAt) : old?.dueAt ?? null,
      state: p.state === 'reported' ? 'reported' : 'promised', confirmedAt: old?.confirmedAt ?? null,
    });
  }
  // Omission must never erase a user's confirmation or a previous commitment.
  for (const p of record.promises) if (!promises.some(x => x.id === p.id)) promises.push(p);
  // Waiting asserts a future reply was promised, not merely that an answer is unknown.
  // Require a validated, linked commitment instead of trusting an unsupported status label.
  for (const q of questions) {
    if (q.aiStatus !== 'waiting' || promises.some(p => p.state === 'promised' && p.questionIds.includes(q.id) && q.evidence.some(e => e.messageId === p.evidence.messageId))) continue;
    q.aiStatus = 'review'; q.aiReason = '향후 안내 약속을 질문의 원문 근거와 연결하지 못했습니다. 직접 확인해 주세요.';
    if (!q.manualStatus) { q.status = q.aiStatus; q.reason = q.aiReason; }
    warnings.push('답변 대기 판정에 연결된 처리 약속이 없어 확인 필요로 표시했습니다.');
  }
  const comparison = compareAnalysis(record, questions, promises, new Date().toISOString());
  const changes = questions.map(q => {
    const old = oldQuestions.find(p => p.id === q.id);
    return old && old.status !== q.status ? `${q.title}: ${statusNames[old.status]} → ${statusNames[q.status]}` : null;
  }).filter(Boolean);
  Object.assign(record, { questions, promises, summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 2000) : '',
    warnings: [...new Set(warnings)], analyzedMessageCount: record.messages.length, drafts: {},
    analysis: { ...meta, at: comparison.at, comparison },
  });
  const label = comparison.kind === 'initial' ? '질문별 확인표가 준비됐어요' : comparison.kind === 'reanalysis' ? '같은 원문을 다시 분석했어요' : comparison.kind === 'reply' ? '새 답변을 확인표에 반영했어요' : '추가 대화를 확인표에 반영했어요';
  const entry = history(record, 'analysis', label, comparison.kind === 'initial' ? `${questions.length}개 질문 · ${promises.length}개 처리 약속` : changes.join('\n') || `질문 변화 ${comparison.questions.length}건 · 약속 변화 ${comparison.promises.length}건`);
  entry.comparison = comparison;
  return record;
}
export function validateDraft(raw, record) {
  if (!raw || typeof raw.body !== 'string' || !raw.body.trim() || raw.body.length > 1600 || !Array.isArray(raw.sourceMessageIds)) throw new AppError(502, '초안 형식이 올바르지 않습니다. 다시 작성해 주세요.', 'DRAFT_FORMAT');
  const sources = raw.sourceMessageIds.map(id => record.messages.find(m => m.id === id));
  if (!sources.length || sources.some(m => !m)) throw new AppError(502, '초안의 원문 근거를 확인할 수 없습니다. 다시 작성해 주세요.', 'DRAFT_EVIDENCE');
  const sourceText = sources.map(m => m.text).join('\n');
  const references = raw.body.match(/\b[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\b/gi) ?? [];
  if (references.some(id => !sourceText.includes(id))) throw new AppError(502, '본문에 내부 메시지 ID가 포함됐습니다. 괄호 안의 UUID 등 참조값은 본문에서 제거하고 sourceMessageIds 필드에만 넣어 주세요.', 'DRAFT_REFERENCE');
  // Messages identify roles, not individual agents. Do not invent actor identity from turn order.
  const actors = raw.body.match(/(?:동일|같은|다른(?:\s*한)?|두(?:\s*[명분])?(?:의)?|여러)\s*(?:상담원|상담사|담당자)/g) ?? [];
  if (actors.some(actor => !sourceText.replaceAll(/\s/g, '').includes(actor.replaceAll(/\s/g, '')))) throw new AppError(502, '원문에서 상담원이 같은 사람인지 다른 사람인지 확인되지 않습니다. 담당자 동일성을 추정하지 말고 이전 답변과 후속 답변으로 표현해 주세요.', 'DRAFT_ACTOR');
  const numbers = raw.body.match(/\d[\d,.]*(?:\s*(?:원|일|월|년|시간|분|%))?/g) ?? [];
  if (numbers.some(n => !sourceText.replaceAll(' ', '').includes(n.replaceAll(' ', '')))) throw new AppError(502, '원문에 없는 숫자나 기한이 초안에 포함되어 제외했습니다. 다시 작성해 주세요.', 'DRAFT_FACT');
  return { body: raw.body, sourceMessageIds: [...new Set(raw.sourceMessageIds)] };
}

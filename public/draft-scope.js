// Stored generation scope, not another AI interpretation of the edited draft.
export function draftScope(record, selected, language, esc) {
  const draft = record.drafts.followup;
  if (!draft || !Array.isArray(draft.questionIds)) return '';
  const ids = new Set(draft.questionIds);
  const changed = ids.size !== selected.size || [...ids].some(id => !selected.has(id)) || draft.language !== language;
  const titles = draft.questionIds.map(id => record.questions.find(q => q.id === id)?.title).filter(Boolean);
  return `<p class="draft-note"><strong>초안 생성에 사용한 질문</strong> · ${titles.map(esc).join(' / ')}</p>${changed ? '<p class="warning-note">질문 선택이나 답장 언어가 초안을 만들 때와 달라요. 현재 선택을 반영하려면 초안을 다시 만들어 주세요. 작성 중인 문장은 유지됩니다.</p>' : ''}`;
}

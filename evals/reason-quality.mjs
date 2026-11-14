// Scoped lexical controls catch known verbosity regressions, not arbitrary semantics.
// Always review every saved reason against its source as well. No product rewriting.
const rules = {
  R01: [{ message: 0, require: ['환불', '불가|안 된|안되|어렵'], forbid: ['예외|절차|금액'] }],
  R05: [{ message: 0, require: ['3.*5.*영업일'], forbid: ['접수|완료 여부'] }],
  R06: [{ message: 0, require: ['업체|판매자'], contextRequire: ['불량'], forbid: ['누락|제공되지|미제공'] }, { message: 1, require: ['고객|구매자'], contextRequire: ['변심'], forbid: ['누락|제공되지|미제공'] }],
  U05: [{ message: 0, require: ['3.*영업일'], forbid: ['정확한.*(날짜|시각|시간)'] }],
  U03: [{ message: 0, require: ['9,?900', '이번 달'], evidenceRequire: ['9,?900', '이번 달.*확인하지 못'] }],
  B06: [{ message: 0, require: ['설정', '스위치|끄|끔|해제'], forbid: ['경로|플랫폼|앱|웹|세부 정보'] }],
  NR06: [{ message: 1, require: ['입금', '알 수 없|확인.*(없|않)|미정|불명|모르'], forbid: ['시점|시각|날짜|거래내역|승인'] }],
  Q01: [{ message: 0, require: ['설정|스위치', '경로', '모르|알 수 없|미정|제공.*않|안내.*않|없|불명'] }],
  Q02: [{ message: 0, require: ['입금', '시각|시간', '알 수 없|확인.*(없|않)|미정|불명|모르'] }],
  Q03: [{ message: 0, require: ['불량', '확인', '환불.*가능'] }],
  Q04: [{ message: 0, require: ['11월 20일|11/20|11-20'], forbid: ['시각|시간|미정|정해지지'] }, { message: 1, require: ['시각|시간', '미정|정해지지|확정.*않|알 수 없'] }],
};
const boilerplate = /제공된 정보\s*:|누락된 정보\s*:|질문이 충족|질문을 충족|답변 완료로 판단|고객은.*물었|부분 (정보|응답|답변)(으)?로 분류/;
export function gradeReasons(record, caseId) {
  const issues = [];
  for (const q of record.questions) {
    if (!q.reason.trim()) issues.push(`empty:${q.id}`);
    if (boilerplate.test(q.reason)) issues.push(`boilerplate:${q.id}`);
  }
  for (const rule of rules[caseId] || []) {
    const messageId = record.messages[rule.message]?.id;
    const matches = record.questions.filter(q => messageId && q.source.messageId === messageId);
    if (matches.length !== 1) { issues.push(`match:${caseId}/${rule.message}:${matches.length}`); continue; }
    const reason = matches[0].reason;
    for (const pattern of rule.require || []) if (!new RegExp(pattern).test(reason)) issues.push(`missing:${caseId}/${rule.message}:${pattern}`);
    // The question remains visible beside its reason. Do not force repetition of
    // a condition already stated in that question; new answer conditions (Q03)
    // must still appear in the reason itself.
    for (const pattern of rule.contextRequire || []) if (!new RegExp(pattern).test(`${matches[0].source.quote || ''} ${reason}`)) issues.push(`missing-context:${caseId}/${rule.message}:${pattern}`);
    for (const pattern of rule.forbid || []) if (new RegExp(pattern).test(reason)) issues.push(`unasked:${caseId}/${rule.message}:${pattern}`);
    const evidence = (matches[0].evidence || []).map(e => e.quote).join('\n');
    for (const pattern of rule.evidenceRequire || []) if (!new RegExp(pattern).test(evidence)) issues.push(`evidence-omitted:${caseId}/${rule.message}:${pattern}`);
  }
  return { pass: !issues.length, issues, checkedQuestions: record.questions.length, scopedChecks: (rules[caseId] || []).length };
}

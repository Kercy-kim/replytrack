export const stages = {
  queued: '앞선 작업을 기다리는 중',
  completion_review: '처리 완료 통보 누락 확인 중',
  email_explanation: '이메일 답변을 한국어로 설명 중', email_review: '번역의 조건·누락·기한 검토 중',
  guide_intent: '원하는 일 파악 중', guide_search: 'SSG 공식 FAQ 검색 중', guide_writing: '내 상황에 맞는 안내 작성 중', guide_review: '공식 근거·조건·예외 대조 중', guide_repair: '검토에서 발견한 안내 오류 수정 중',
  actions: '업체가 요청한 할 일 읽는 중', actions_review: '할 일의 조건·누락·이후 안내 검토 중',
  starting: '작업 접수 중', connection: 'AI 연결 확인 중', ocr: '캡처에서 글자 읽기 준비 중', ocr_reading: '캡처의 글자를 읽는 중',
  masking: '전화번호·주소 마스킹 중', reading: '보낸 사람과 답변 정리 중', analysis: '질문·답변·약속 분석 중',
  analysis_repair: '원문에 맞춰 분석 수정 중', validation: '원문 근거 검증 중', boundary_review: '불명확한 질문 상태 검토 중',
  draft: '초안 작성 중', draft_review: '초안 의미·누락 검토 중', draft_repair: '검토 결과로 초안 수정 중', saving: '검증된 결과 저장 중',
};
export const elapsedLabel = milliseconds => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
};

export class WebOperation {
  constructor(api, onUpdate, { pollMs = 500, id = crypto.randomUUID() } = {}) {
    this.api = api; this.onUpdate = onUpdate; this.pollMs = pollMs; this.id = id;
    this.snapshot = { id, state: 'running', stage: 'starting', elapsedMs: 0, events: [] };
    this.receivedAt = performance.now(); this.cancelRequested = false; this.cancelling = false;
  }
  update(job) {
    if (this.snapshot.state !== 'running' && job.state === 'running') return;
    this.snapshot = job; this.receivedAt = performance.now(); this.warning = ''; this.onUpdate(this);
  }
  get elapsedMs() { return this.snapshot.elapsedMs + (this.snapshot.state === 'running' ? performance.now() - this.receivedAt : 0); }
  async cancel() {
    if (this.cancelling || this.snapshot.state !== 'running') return;
    this.cancelRequested = true; this.onUpdate(this);
    if (!this.acknowledged) return;
    this.cancelling = true; this.onUpdate(this);
    try { this.update(await this.api(`/api/operations/${this.id}`, 'DELETE', {})); }
    catch { this.warning = '취소 확인에 연결하지 못했어요. 상태를 다시 확인 중이며 취소를 다시 누를 수 있어요.'; }
    finally { this.cancelling = false; this.onUpdate(this); }
  }
  async run(kind, input = {}, caseId) {
    this.onUpdate(this);
    try {
      let job;
      try { job = await this.api('/api/operations', 'POST', { id: this.id, kind, input, caseId }); }
      catch (error) {
        if (error.status) throw error;
        // A lost POST response must not trigger a duplicate paid request.
        try { job = await this.api(`/api/operations/${this.id}`); }
        catch { throw new Error('작업 접수 상태를 확인하지 못했어요. 입력은 유지됩니다. 연결 복구 후 기록을 확인해 주세요.'); }
      }
      this.acknowledged = true; this.update(job);
      if (this.cancelRequested) await this.cancel();
      const deadline = performance.now() + 960000;
      while (this.snapshot.state === 'running') {
        await new Promise(resolve => setTimeout(resolve, this.pollMs));
        if (this.snapshot.state !== 'running') break;
        try { this.update(await this.api(`/api/operations/${this.id}`)); }
        catch (error) {
          if (error.status === 404) throw error;
          if (performance.now() > deadline) throw new Error('연결이 끊겨 작업 결과를 확인하지 못했어요. 입력은 유지됩니다. 연결 복구 후 저장된 기록을 확인해 주세요.');
          this.warning = '서버 연결을 다시 확인하고 있어요. 취소가 확인되기 전까지 작업이 진행될 수 있어요.'; this.onUpdate(this);
        }
      }
      if (this.snapshot.state === 'completed') return this.snapshot.result;
      throw Object.assign(new Error(this.snapshot.error.message), this.snapshot.error);
    } catch (error) {
      // Best effort on transport loss; never claim confirmed cancellation without a response.
      if (this.snapshot.state === 'running') await this.cancel();
      throw error;
    }
  }
}

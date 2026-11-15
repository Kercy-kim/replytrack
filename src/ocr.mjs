import { Worker } from 'node:worker_threads';
import { AppError } from './errors.mjs';
import { checkpoint, cancelled } from './operation.mjs';

// A dedicated parent worker lets us also cancel during Tesseract initialization.
// Images, language models, recognition and masking stay on this local server.
export async function readImage(image, context = {}) {
  checkpoint(context, 'ocr');
  const worker = new Worker(new URL('./ocr-worker.mjs', import.meta.url), { workerData: { image, language: context.ocrLanguage === 'eng' ? 'eng' : 'kor+eng' }, stdout: true, stderr: true });
  // Engine diagnostics can contain recognized text; expose only our sanitized errors.
  worker.stdout.resume(); worker.stderr.resume();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, text) => {
      if (settled) return; settled = true;
      clearTimeout(timer); context.signal?.removeEventListener('abort', abort);
      const settle = () => error ? reject(error) : resolve(text);
      worker.terminate().then(settle, settle);
    };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new AppError(504, '캡처를 읽는 시간이 초과됐어요. 더 작은 캡처나 텍스트로 다시 시도해 주세요.', 'OCR_TIMEOUT')), 60000);
    context.signal?.addEventListener('abort', abort, { once: true });
    if (context.signal?.aborted) abort();
    worker.on('message', message => {
      if (message.stage) context.onStage?.(message.stage);
      else if (message.error) finish(new AppError(422, '캡처에서 글자를 읽지 못했어요. 텍스트로 붙여넣거나 다른 캡처를 선택해 주세요.', 'OCR_FAILED'));
      else finish(null, message.text);
    });
    worker.on('error', () => finish(new AppError(422, '로컬 캡처 인식을 실행하지 못했어요. npm ci 실행 후 다시 시도하거나 텍스트를 붙여넣어 주세요.', 'OCR_FAILED')));
    worker.on('exit', () => { if (!settled) finish(new AppError(422, '캡처 인식이 중단됐어요. 입력은 유지됩니다.', 'OCR_FAILED')); });
  });
}

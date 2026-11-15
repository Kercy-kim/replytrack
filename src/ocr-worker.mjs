import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import kor from '@tesseract.js-data/kor';
import eng from '@tesseract.js-data/eng';
import { mkdir, link, copyFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let worker;
try {
  // Use local language paths. No CDN fetch or image file is needed at runtime.
  const langPath = resolve(fileURLToPath(new URL('..', import.meta.url)), process.env.REPLYTRACK_DATA_DIR || 'data', 'ocr-models');
  await mkdir(langPath, { recursive: true });
  for (const lang of [kor, eng]) {
    const filename = `${lang.code}.traineddata.gz`;
    try { await link(join(lang.langPath, filename), join(langPath, filename)); }
    catch (error) {
      if (error.code === 'EXDEV') {
        // Cross-volume fallback: publish only a complete model, even if cancelled mid-copy.
        const temporary = join(langPath, `${filename}.${randomUUID()}.tmp`);
        await copyFile(join(lang.langPath, filename), temporary);
        await rename(temporary, join(langPath, filename));
      } else if (error.code !== 'EEXIST') throw error;
    }
  }
  worker = await createWorker(workerData.language, 1, { langPath, cacheMethod: 'none', gzip: true,
    logger: event => { if (event.status === 'recognizing text') parentPort.postMessage({ stage: 'ocr_reading' }); }, errorHandler: () => {} });
  const result = await worker.recognize(Buffer.from(workerData.image.split(',')[1], 'base64'));
  parentPort.postMessage({ text: result.data.text });
} catch { parentPort.postMessage({ error: true }); }
finally { await worker?.terminate(); }

import assert from 'node:assert/strict';
import test from 'node:test';

import { createZipDownload } from '../src/zip-download.js';

test('createZipDownload creates a zip file with all provided files', () => {
  const file = createZipDownload(
    [
      { name: 'sample.srt', content: '1\n00:00:00,000 --> 00:00:01,000\nHi\n', type: 'text/plain' },
      { name: 'sample.json', content: '{"ok":true}\n', type: 'application/json' },
    ],
    'sample video.mp4',
  );

  const bytes = file.content;
  const text = new TextDecoder().decode(bytes);

  assert.equal(file.label, 'ZIP 다운로드');
  assert.equal(file.name, 'sample video.subtitles.zip');
  assert.equal(file.type, 'application/zip');
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(text, /sample\.srt/);
  assert.match(text, /sample\.json/);
  assert.deepEqual([...bytes.slice(-2)], [0x00, 0x00]);
});

// Run through /tests/browser-workflow.html on localhost, never against real API IO.
const results = [];
const output = document.querySelector('#workflowResults');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const $ = (selector) => document.querySelector(selector);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const change = (element) => element.dispatchEvent(new Event('change', { bubbles: true }));
const resultOptions = () => [...$('#jobResultSelect').options].filter((option) => option.value);
const rowCount = () => document.querySelectorAll('#editorBody [data-cue-index]').length;
const translated = () => $('#editorBody [data-edit-field="translated"]');
const io = { mode: 'success', requests: 0, transcriptions: 0, writes: [], pending: 0, aborted: 0, terminated: 0 };

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${description}`);
    await delay(20);
  }
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}

function chooseResult(value) {
  $('#jobResultSelect').value = value;
  change($('#jobResultSelect'));
}

async function selectVideos(names) {
  const files = names.map((name) => new File(['fixture video'], name, { type: 'video/mp4' }));
  Object.defineProperty($('#videoFile'), 'files', { configurable: true, value: files });
  change($('#videoFile'));
  await waitFor(() => !$('#startButton').disabled, 'file metadata and ready state');
}

async function runBatch(names, mode = 'success') {
  io.mode = mode;
  await selectVideos(names);
  $('#startButton').click();
  await waitFor(() => $('#cancelButton').disabled && !$('#videoFile').disabled, 'batch completion and lock release');
}

function assertDownloadName(name) {
  const links = [...document.querySelectorAll('#downloads a[download]')];
  assert(links.length > 0, 'download links are missing');
  assert(links.every((link) => link.download.includes(name)), `export filename must contain ${name}`);
}

try {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), 'Fixture requires localhost');
  const realFetch = window.fetch.bind(window);
  const documentText = await (await realFetch('../index.html')).text();
  const markup = new DOMParser().parseFromString(documentText, 'text/html');
  document.body.append(document.importNode(markup.querySelector('.app-shell'), true));

  // Isolate credentials/settings so fixture execution never reads or rewrites saved user data.
  const memory = new Map();
  const storageAccess = { reads: 0, writes: 0 };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key) => { storageAccess.reads += 1; return memory.get(key) ?? null; },
    setItem: (key, value) => { storageAccess.writes += 1; memory.set(key, String(value)); },
    removeItem: (key) => memory.delete(key),
  } });
  Object.defineProperty($('#videoPreview'), 'duration', { configurable: true, get: () => 10 });

  const { BrowserFfmpeg } = await import('../src/ffmpeg-pipeline.js');
  BrowserFfmpeg.prototype.load = async function () { this.loaded = true; };
  BrowserFfmpeg.prototype.writeInput = async function (file) {
    io.writes.push(file.name);
    io.fileName = file.name;
    return file.name;
  };
  BrowserFfmpeg.prototype.extractAudio = async () => 'fixture.mp3';
  BrowserFfmpeg.prototype.detectSilence = async () => [];
  BrowserFfmpeg.prototype.splitAudio = async function* ({ chunks }) {
    for (const chunk of chunks) {
      yield { ...chunk, startTime: chunk.extractStart, coreStartTime: chunk.start,
        coreEndTime: chunk.end, audioBlob: new Blob(['fixture audio'], { type: 'audio/mpeg' }),
        fileName: `fixture-${chunk.index}.mp3` };
    }
  };
  BrowserFfmpeg.prototype.cleanup = async function () { this.files.clear(); };
  BrowserFfmpeg.prototype.terminate = function () { this.loaded = false; io.terminated += 1; };

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.endsWith('/audio/transcriptions') && !url.pathname.endsWith('/responses')) {
      return realFetch(input, init);
    }
    io.requests += 1;
    if (url.pathname.endsWith('/audio/transcriptions')) io.transcriptions += 1;
    if (io.mode === 'translation-failure' && url.pathname.endsWith('/responses')) {
      return Response.json({ error: { message: 'Fixture translation unauthorized' } }, { status: 401 });
    }
    if (io.mode === 'pending' || (io.mode === 'pending-translation' && url.pathname.endsWith('/responses'))) {
      io.pending += 1;
      return new Promise((resolve, reject) => {
        const abort = () => { io.aborted += 1; reject(new DOMException('Fixture cancelled', 'AbortError')); };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (io.mode === 'fail-second' && io.fileName.includes('fails')) {
      return Response.json({ error: { message: 'Fixture unauthorized', type: 'authentication_error' } }, { status: 401 });
    }
    if (url.pathname.endsWith('/audio/transcriptions')) {
      return Response.json({ text: 'Hello world', segments: [{ start: 0, end: 2, text: 'Hello world' }] });
    }
    const request = JSON.parse(init.body);
    const subtitles = JSON.parse(request.input).subtitles;
    return Response.json({ output_text: JSON.stringify({ translations: subtitles.map(({ id }) => ({ id, translated: '안녕하세요 세계' })) }) });
  };

  await import('../src/app.js');
  await check('empty player stays compact before media selection', async () => {
    assert($('#videoPreview').hidden, 'empty video must be hidden');
    assert($('#subtitlePanel').hidden, 'empty subtitle box must be hidden');
    assert($('#mediaEmptyState') && !$('#mediaEmptyState').hidden, 'compact media guidance must be visible');
  });
  const direct = $('input[name="connectionMode"][value="browser"]');
  direct.checked = true;
  change(direct);
  $('#apiKey').value = 'sk-fixture-no-network';
  $('#apiKey').dispatchEvent(new Event('input', { bubbles: true }));
  change($('#apiKey'));

  await check('import before media selection preserves subtitles and result when video is attached', async () => {
    const file = new File(['1\n00:00:01,000 --> 00:00:03,000\nFirst import\n'], 'before-media.srt', { type: 'text/plain' });
    Object.defineProperty($('#subtitleFile'), 'files', { configurable: true, value: [file] });
    change($('#subtitleFile'));
    await waitFor(() => resultOptions().length === 1 && !$('#subtitleFile').disabled, 'initial import');
    const id = $('#jobResultSelect').value;
    const original = translated().value;
    await selectVideos(['first-attachment.mp4']);
    assert($('#jobResultSelect').value === id && rowCount() === 1, 'media selection must preserve imported result');
    assert(translated().value === original, 'media selection must preserve imported text');
    assert($('#exportSubtitleCount').textContent === '1개', 'import must update export count');
  });

  let firstId;
  let secondId;
  await check('two-file batch retains both selectable results and exports the selected filename', async () => {
    const before = resultOptions().length;
    await runBatch(['first.mp4', 'second.mp4']);
    const options = resultOptions();
    assert(options.length === before + 2, `Expected two new results, found ${options.length - before}`);
    firstId = options.find((option) => option.textContent.includes('first.mp4'))?.value;
    secondId = options.find((option) => option.textContent.includes('second.mp4'))?.value;
    assert(firstId && secondId && firstId !== secondId, 'result identities must be unique');
    chooseResult(firstId);
    translated().value = '수정한 첫 번째 자막';
    change(translated());
    assertDownloadName('first');
  });

  await check('split undo redo and per-result history restoration', async () => {
    assert(firstId && secondId, 'batch results required');
    chooseResult(firstId);
    const before = rowCount();
    $('#editorBody [data-editor-action="split"]').click();
    assert(rowCount() === before + 1, 'split must add one row');
    assert(!$('#undoEdit').disabled, 'undo must be enabled');
    $('#undoEdit').click();
    assert(rowCount() === before, 'undo must restore row count');
    assert(translated().value === '수정한 첫 번째 자막', 'undo must restore edited text');
    $('#redoEdit').click();
    assert(rowCount() === before + 1, 'redo must restore split');
    chooseResult(secondId);
    assert($('#undoEdit').disabled, 'second result must have independent history');
    chooseResult(firstId);
    assert(rowCount() === before + 1 && !$('#undoEdit').disabled, 'first result history must survive switching');
    $('#undoEdit').click();
    assert(translated().value === '수정한 첫 번째 자막', 'restored history undo must work');
    assert($('#editHistoryStatus').textContent.length > 0, 'history status must be visible');
  });

  await check('secondary cue actions expand and remain usable after a timing edit', async () => {
    chooseResult(firstId);
    document.querySelector('[data-tab-target="edit"]').click();
    assert(!$('#videoPreview').hidden, 'selected media must show its player');
    assert($('#mediaEmptyState').hidden, 'media guidance must collapse after selection');
    const row = $('#editorBody [data-cue-index]');
    assert(row.querySelector('.cue-actions').querySelectorAll('button').length === 2, 'only two primary actions should be shown per cue');
    const details = row.querySelector('details.cue-more');
    assert(details && !details.open, 'secondary actions must start collapsed');
    details.querySelector('summary').click();
    assert(details.open, 'secondary actions must expand');
    const before = Number(row.querySelector('[data-time-field="start"]').value);
    details.querySelector('[data-shift-delta="0.5"]').click();
    assert(Number($('#editorBody [data-time-field="start"]').value) === before + 0.5, 'expanded timing action must work');
    assert($('#editorBody details.cue-more').open, 'secondary actions must stay open after editing');
    $('#undoEdit').click();
  });

  await check('permanent 401 on batch second file preserves completed result and releases locks', async () => {
    const before = resultOptions().length;
    await runBatch(['survives.mp4', 'fails.mp4'], 'fail-second');
    assert(resultOptions().length === before + 1, 'completed first result must remain after second failure');
    assert($('#runPanel').dataset.runState === 'failed', '401 must mark run failed');
    assert(!$('#jobResultSelect').disabled && !$('#startButton').disabled, 'failure must release controls');
    const survived = resultOptions().find((option) => option.textContent.includes('survives.mp4'));
    assert(survived, 'successful first result missing');
    chooseResult(survived.value);
    assertDownloadName('survives');
  });

  await check('cancel aborts pending request and never starts the next batch task', async () => {
    const before = resultOptions().length;
    io.mode = 'pending';
    const writeStart = io.writes.length;
    await selectVideos(['cancel-current.mp4', 'cancel-never-start.mp4']);
    $('#startButton').click();
    await waitFor(() => io.pending > 0, 'pending API request');
    $('#cancelButton').click();
    await waitFor(() => $('#cancelButton').disabled && !$('#videoFile').disabled, 'cancellation lock release');
    const requests = io.requests;
    await delay(150);
    assert(io.aborted > 0 && io.terminated > 0, 'cancel must abort request and terminate FFmpeg');
    assert(io.requests === requests, 'no request may start after cancellation');
    assert(io.writes.slice(writeStart).join(',') === 'cancel-current.mp4', 'next batch file must never start');
    assert(resultOptions().length === before, 'cancelled partial output must not be saved');
    assert($('#runPanel').dataset.runState === 'cancelled', 'run must show cancellation');
  });

  await check('imported subtitle is selectable editable and exports its own filename', async () => {
    const before = resultOptions().length;
    const subtitle = new File(['1\n00:00:00,000 --> 00:00:02,000\nImported text\n'], 'imported.srt', { type: 'text/plain' });
    Object.defineProperty($('#subtitleFile'), 'files', { configurable: true, value: [subtitle] });
    change($('#subtitleFile'));
    await waitFor(() => resultOptions().length === before + 1 && !$('#subtitleFile').disabled, 'subtitle import');
    const imported = resultOptions().find((option) => option.textContent.includes('imported.srt'));
    assert(imported, 'imported result missing');
    chooseResult(imported.value);
    translated().value = '가져온 자막 수정';
    change(translated());
    assertDownloadName('imported');
    chooseResult(firstId);
    chooseResult(imported.value);
    assert(translated().value === '가져온 자막 수정', 'imported edit must survive switching');
  });
  await check('translation failure preserves original and retry does not transcribe again', async () => {
    const before = resultOptions().length;
    await runBatch(['recover.mp4'], 'translation-failure');
    assert(resultOptions().length === before + 1, 'completed transcription must be retained');
    assertDownloadName('recover');
    assert(!$('#translationRecovery').hidden, 'translation retry guidance must be visible');
    const id = $('#jobResultSelect').value;
    const transcriptions = io.transcriptions;
    io.mode = 'success';
    $('#retryTranslationButton').click();
    await waitFor(() => $('#cancelButton').disabled, 'translation retry completion');
    assert(io.transcriptions === transcriptions, 'retry must not repeat transcription');
    assert($('#jobResultSelect').value === id && resultOptions().length === before + 1, 'retry must update the same result');
    assert($('#translationRecovery').hidden && translated().value === '안녕하세요 세계', 'retry must finish translation');
    assert($('#exportSubtitleCount').textContent === `${rowCount()}개`, 'export count must match edited cues');
  });
  await check('cancelling translation retains downloadable original', async () => {
    const before = resultOptions().length;
    const pending = io.pending;
    io.mode = 'pending-translation';
    await selectVideos(['cancel-translation.mp4']);
    $('#startButton').click();
    await waitFor(() => io.pending > pending, 'pending translation');
    $('#cancelButton').click();
    await waitFor(() => $('#cancelButton').disabled, 'translation cancelled');
    assert(resultOptions().length === before + 1, 'original must survive cancellation');
    assertDownloadName('cancel-translation');
    assert(!$('#translationRecovery').hidden, 'cancelled translation must be retryable');
  });
  await check('media attachment preserves edits and association across results', async () => {
    chooseResult(firstId);
    const text = translated().value;
    const count = rowCount();
    const media = new File(['media'], 'attached.mp4', { type: 'video/mp4' });
    Object.defineProperty($('#attachMediaFile'), 'files', { configurable: true, value: [media] });
    change($('#attachMediaFile'));
    await waitFor(() => !$('#attachMediaFile').disabled, 'attachment completion');
    chooseResult(secondId);
    chooseResult(firstId);
    assert(translated().value === text && rowCount() === count, 'attachment must preserve edited cues');
    assert($('#fileMeta').textContent.includes('attached.mp4'), 'media association must survive switching');
  });
  await check('tabs expose selection and keyboard navigation', async () => {
    const generate = $('[data-tab-target="generate"]');
    generate.click();
    generate.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert($('[data-tab-target="edit"]').getAttribute('aria-selected') === 'true', 'arrow key must select next tab');
    assert(generate.getAttribute('aria-selected') === 'false', 'inactive tab must be unselected');
  });
  await check('export language belongs to the result and warning filter uses custom thresholds', async () => {
    $('#targetLanguage').value = 'en';
    change($('#targetLanguage'));
    await runBatch(['english.mp4']);
    assert($('#downloads a').download.endsWith('.en.srt'), 'English result must export en filename');
    $('#targetLanguage').value = 'ja';
    change($('#targetLanguage'));
    chooseResult(firstId);
    const english = resultOptions().find((option) => option.textContent.includes('english.mp4'));
    chooseResult(english.value);
    assert($('#downloads a').download.endsWith('.en.srt'), 'changing settings must not rename past results');
    $('#maxSubtitleChars').value = '2';
    $('#maxSubtitleChars').dispatchEvent(new Event('input', { bubbles: true }));
    $('#editorStatusFilter').value = 'warning';
    change($('#editorStatusFilter'));
    assert(rowCount() > 0, 'custom length warnings must be included in warning filter');
    $('#maxSubtitleChars').value = '1000';
    $('#maxSubtitleSeconds').value = '1000';
    $('#maxSubtitleCps').value = '1000';
    $('#maxSubtitleChars').dispatchEvent(new Event('input', { bubbles: true }));
    assert(rowCount() === 0, 'warning filter must exclude cues within the custom limits');
    assert($('#overallProgress').getAttribute('aria-valuenow') === '100', 'progress must announce completed value');
  });
  await check('API and connection workflows never read or write persistent storage', async () => {
    assert(storageAccess.reads === 0 && storageAccess.writes === 0, 'credentials and connection settings must remain in memory');
    window.dispatchEvent(new Event('pagehide'));
    assert($('#apiKey').value === '', 'leaving the page must clear its key field');
  });
} catch (error) {
  results.push({ name: 'fixture setup', passed: false, error: error.message });
} finally {
  const report = { passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    mockIO: 'FFmpeg and transcription/translation API are deterministic fakes; no real model or media processing.', results };
  output.textContent = JSON.stringify(report, null, 2);
  window.__workflowDone = true;
}

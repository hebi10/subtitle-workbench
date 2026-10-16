// Browser verification fixture only. This file is never loaded by index.html.
// Inject before app.js in a local browser test; no network/API requests are made.
(() => {
  const cue = (index) => ({ start: index * 3, end: index * 3 + 2.8, original: `Original subtitle ${index + 1}`, translated: `테스트 번역 자막 ${index + 1}` });
  const originalSettings = { sourceLanguage: 'en', targetLanguage: 'ko', translate: true, translationModel: 'original-model' };
  const completed = { id: 'complete-1', uri: 'content://fixture/video', name: '150분 인터뷰 테스트.mp4', durationMs: 9000000, status: 'completed', stage: 'completed', completedChunks: 22, totalChunks: 22, settings: originalSettings };
  const partial = { id: 'partial-1', uri: 'content://fixture/partial', name: '이어하기 테스트.mp4', durationMs: 9000000, status: 'paused', stage: 'transcribing', completedChunks: 2, totalChunks: 22, settings: originalSettings, progress: { percent: 12.5, processedMs: 840000, transcribedChunks: 3, translatedChunks: 2, currentChunk: 3, batchCompleted: 2, batchTotal: 5, extractionPercent: null, elapsedMs: 125000, lastSavedAt: Date.now(), message: '번역 응답을 기다리는 중' } };
  const state = { jobs: [completed, partial], hasKey: true, keyCheck: null, cues: { 'complete-1': Array.from({ length: 27 }, (_, index) => cue(index)), 'partial-1': [cue(0), cue(1)] }, calls: [], failSave: false, failConnection: false };
  window.mockNative = state;
  state.settings = JSON.parse(sessionStorage.getItem('mockNative.settings') || 'null') || { sourceLanguage: 'auto', targetLanguage: 'ko', translate: true, translationModel: 'gpt-6-luna' };
  window.Native = { postMessage(raw) {
    const { id, method, params } = JSON.parse(raw);
    state.calls.push({ id, method, params });
    setTimeout(() => {
      try {
        let result = true;
        const job = state.jobs.find((item) => item.id === params.jobId);
        switch (method) {
          case 'status': result = { jobs: state.jobs, hasKey: state.hasKey, keyCheck: state.keyCheck, settings: state.settings, maxDurationMs: 10800000 }; break;
          case 'getSettings': result = state.settings; break;
          case 'setSettings': if (state.settings.translationModel !== params.settings.translationModel) state.keyCheck = null; state.settings = params.settings; sessionStorage.setItem('mockNative.settings', JSON.stringify(state.settings)); break;
          case 'setKey': state.hasKey = Boolean(params.key); state.keyCheck = null; break;
          case 'clearKey': state.hasKey = false; state.keyCheck = null; break;
          case 'checkConnection': if (state.failConnection) throw new Error('테스트 모델에 접근할 수 없습니다. 모델 이름을 확인해 주세요.'); result = state.keyCheck = { checkedAt: Date.now(), transcriptionModel: 'whisper-1', translationModel: params.settings.translationModel, message: '키 인증과 모델 접근 확인' }; break;
          case 'openApiKeyPage': break;
          case 'pickVideo': {
            const replacement = params.replaceJobId ? state.jobs.find((item) => item.id === params.replaceJobId) : null;
            if (params.replaceJobId && (!replacement || replacement.status !== 'paused' || replacement.stage !== 'ready' || replacement.completedChunks || state.cues[replacement.id]?.length)) throw new Error('생성을 시작하지 않은 준비 작업만 변경할 수 있습니다.');
            if (state.failNextPick) { const reason = state.failNextPick; state.failNextPick = false; throw new Error(typeof reason === 'string' ? reason : '테스트 영상 선택 실패'); }
            if (state.cancelNextPick) { state.cancelNextPick = false; result = null; break; }
            const ready = { ...partial, id: replacement?.id || `ready-${state.jobs.filter((item) => item.id.startsWith('ready-')).length + 1}`, name: replacement ? '다시 선택한 영상.mp4' : '선택한 영상.mp4', status: 'paused', stage: 'ready', completedChunks: 0, settings: { ...params.settings }, progress: { percent: 0, processedMs: 0, transcribedChunks: 0, translatedChunks: 0, currentChunk: 0, batchCompleted: 0, batchTotal: 0, extractionPercent: null, elapsedMs: 0, lastSavedAt: 0 } };
            if (replacement) state.jobs[state.jobs.indexOf(replacement)] = ready; else state.jobs.push(ready);
            state.cues[ready.id] = []; result = { job: ready, cues: [] }; break;
          }
          case 'updatePreparedSettings':
            if (!job || job.status !== 'paused' || job.stage !== 'ready' || job.completedChunks || state.cues[job.id]?.length) throw new Error('생성을 시작하지 않은 준비 작업만 변경할 수 있습니다.');
            job.settings = { ...params.settings }; result = job; break;
          case 'cancelPrepared':
            if (!job || job.status !== 'paused' || job.stage !== 'ready' || job.completedChunks || state.cues[job.id]?.length) throw new Error('생성을 시작하지 않은 준비 작업만 취소할 수 있습니다.');
            state.jobs = state.jobs.filter((item) => item.id !== job.id); delete state.cues[job.id]; break;
          case 'loadJob': result = { job, cues: state.cues[params.jobId] }; break;
          case 'saveCues': if (state.failSave) throw new Error('테스트 저장 실패'); if (job.status !== 'completed') throw new Error('완료된 작업만 편집할 수 있습니다.'); state.cues[job.id] = params.cues; break;
          case 'resume': job.status = 'running'; if (job.stage === 'ready') job.stage = 'extracting'; if (params.translationModel) job.settings = { ...job.settings, translationModel: params.translationModel }; break;
          case 'pause': job.status = 'paused'; break;
          case 'preview': break;
          case 'export': result = state.cancelNextExport ? null : { saved: true }; state.cancelNextExport = false; break;
          case 'importSubtitles': result = { name: '가져온 자막.srt', text: '1\n00:00:01,000 --> 00:00:03,000\n가져온 자막입니다.\n' }; break;
          case 'importCues': { const imported = { ...completed, id: `import-${state.jobs.length}`, name: params.name, uri: '', durationMs: 3000 }; state.jobs.push(imported); state.cues[imported.id] = params.cues; result = { job: imported, cues: params.cues }; break; }
          default: throw new Error(`Unknown fixture method: ${method}`);
        }
        window.nativeResult(JSON.parse(JSON.stringify({ id, result })));
      } catch (error) { window.nativeResult({ id, error: error.message }); }
    }, state.methodDelays?.[method] ?? 20);
  } };
})();

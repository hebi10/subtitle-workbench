// Browser verification fixture only. This file is never loaded by index.html.
// Inject before app.js in a local browser test; no network/API requests are made.
(() => {
  const cue = (index) => ({ start: index * 3, end: index * 3 + 2.8, original: `Original subtitle ${index + 1}`, translated: `테스트 번역 자막 ${index + 1}` });
  const completed = { id: 'complete-1', uri: 'content://fixture/video', name: '150분 인터뷰 테스트.mp4', durationMs: 9000000, status: 'completed', stage: 'completed', completedChunks: 22, totalChunks: 22 };
  const partial = { id: 'partial-1', uri: 'content://fixture/partial', name: '이어하기 테스트.mp4', durationMs: 9000000, status: 'paused', stage: 'transcribing', completedChunks: 2, totalChunks: 22 };
  const state = { jobs: [completed, partial], hasKey: true, cues: { 'complete-1': Array.from({ length: 27 }, (_, index) => cue(index)), 'partial-1': [cue(0), cue(1)] }, calls: [], failSave: false };
  window.mockNative = state;
  state.settings = JSON.parse(sessionStorage.getItem('mockNative.settings') || 'null') || { sourceLanguage: 'auto', targetLanguage: 'ko', translate: true, translationModel: 'gpt-5.5' };
  window.Native = { postMessage(raw) {
    const { id, method, params } = JSON.parse(raw);
    state.calls.push({ id, method, params });
    setTimeout(() => {
      try {
        let result = true;
        const job = state.jobs.find((item) => item.id === params.jobId);
        switch (method) {
          case 'status': result = { jobs: state.jobs, hasKey: state.hasKey, settings: state.settings }; break;
          case 'getSettings': result = state.settings; break;
          case 'setSettings': state.settings = params.settings; sessionStorage.setItem('mockNative.settings', JSON.stringify(state.settings)); break;
          case 'setKey': state.hasKey = Boolean(params.key); break;
          case 'pickVideo': result = null; break;
          case 'loadJob': result = { job, cues: state.cues[params.jobId] }; break;
          case 'saveCues': if (state.failSave) throw new Error('테스트 저장 실패'); if (job.status !== 'completed') throw new Error('완료된 작업만 편집할 수 있습니다.'); state.cues[job.id] = params.cues; break;
          case 'resume': job.status = 'running'; break;
          case 'pause': job.status = 'paused'; break;
          case 'preview': break;
          case 'export': result = { saved: true }; break;
          case 'importSubtitles': result = { name: '가져온 자막.srt', text: '1\n00:00:01,000 --> 00:00:03,000\n가져온 자막입니다.\n' }; break;
          case 'importCues': { const imported = { ...completed, id: `import-${state.jobs.length}`, name: params.name, uri: '', durationMs: 3000 }; state.jobs.push(imported); state.cues[imported.id] = params.cues; result = { job: imported, cues: params.cues }; break; }
          default: throw new Error(`Unknown fixture method: ${method}`);
        }
        window.nativeResult(JSON.parse(JSON.stringify({ id, result })));
      } catch (error) { window.nativeResult({ id, error: error.message }); }
    }, 20);
  } };
})();

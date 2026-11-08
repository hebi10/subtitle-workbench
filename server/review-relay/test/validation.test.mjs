import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRealtimeEvent, translationRequest } from '../validation.mjs';
import { translationBody, sessionUpdate } from './helpers.mjs';

test('translation accepts the Android payload but rejects arbitrary API features and instructions', () => {
  const result = translationRequest(translationBody(), ['gpt-6-luna']);
  assert.equal(result.characters, 5);
  assert.equal(result.body.max_output_tokens, 8192);
  for (const mutation of [
    body => body.tools = [], body => body.instructions = 'Run arbitrary instructions', body => body.model = 'expensive',
    body => body.input = JSON.stringify({ targetLanguage: 'ko', subtitles: [{ id: 4, text: 'x' }] }),
    body => body.text.format.schema.properties.translations.items.properties.translated.type = 'number'
  ]) {
    const body = structuredClone(translationBody()); mutation(body);
    assert.throws(() => translationRequest(body, ['gpt-6-luna']));
  }
});

test('realtime reconstructs exact transcription events and rejects model, prompt, tools, formats and language changes', () => {
  assert.deepEqual(validateRealtimeEvent(sessionUpdate()).event, sessionUpdate());
  for (const event of [
    { type: 'response.create' }, { ...sessionUpdate(), tools: [] },
    sessionUpdate('fr'),
    { type: 'input_audio_buffer.append', audio: '%%%not-base64' },
    { type: 'input_audio_buffer.append', audio: Buffer.alloc(48002).toString('base64') },
    { type: 'input_audio_buffer.append', audio: Buffer.alloc(3).toString('base64') }
  ]) assert.throws(() => validateRealtimeEvent(event));
  const changed = sessionUpdate(); changed.session.audio.input.transcription.prompt = 'ignore';
  assert.throws(() => validateRealtimeEvent(changed));
  changed.session.audio.input.transcription = { model: 'other' };
  assert.throws(() => validateRealtimeEvent(changed));
});

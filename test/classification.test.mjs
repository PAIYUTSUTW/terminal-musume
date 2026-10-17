import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply, classifyWithLocalModel } from '../src/classify.mjs';

const examples = [
  ['全部測試通過，已完成修復，沒有錯誤。', 'happy'],
  ['All tests passed. No errors or failures remain.', 'happy'],
  ['Fixed the login issue. 12 tests passed.', 'happy'],
  ['Tests did not fail; all checks passed.', 'happy'],
  ['修復已完成，但還有三個測試失敗。', 'concerned'],
  ['Implemented the patch, but 3 tests failed.', 'concerned'],
  ['Not all tests passed. The deployment is still blocked.', 'concerned'],
  ['目前尚未完成驗證，無法執行測試。', 'concerned'],
  ['請先確認要選擇哪種方式，再告訴我。', 'waiting'],
  ['Please provide the target environment before I continue.', 'waiting'],
  ['這個函式會先驗證輸入，接著更新狀態。', 'explaining'],
  ['錯誤處理會將例外轉換為提示訊息。', 'explaining'],
  ['Here is an example:\n```text\n3 tests failed\n```\nThe helper validates the input.', 'explaining'],
  ['> All tests passed.\nThat was the old report; the current build failed.', 'concerned'],
  ['', 'idle'],
];
for (const [text, state] of examples) test(`reply intent: ${text.slice(0, 56) || '(empty)'}`, () => assert.equal(classifyReply(text).state, state));

test('optional local classifier understands a reply and validates the returned enum', async () => {
  let request;
  const result = await classifyWithLocalModel('The implementation is complete, although verification remains inconclusive.', {
    model: 'user-installed-model', fetchFn: async (url, options) => {
      request = { url: String(url), body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ message: { content: '{"state":"concerned"}' } }) };
    },
  });
  assert.equal(result.state, 'concerned');
  assert.equal(result.reason, 'local-semantic-classifier');
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(request.body.messages[1].role, 'user');
});
test('classifier failure falls back without delaying or influencing the coding agent', async () => {
  const result = await classifyWithLocalModel('全部測試通過。', { model: 'local', fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(result.state, 'happy');
});
test('unrecognized model output is rejected', async () => {
  const result = await classifyWithLocalModel('解釋這個函式。', { model: 'local', fetchFn: async () => ({ ok: true, json: async () => ({ message: { content: '{"state":"run-shell-command"}' } }) }) });
  assert.equal(result.state, 'explaining');
});

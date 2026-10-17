let provider = 'claude';
let current;
const $ = selector => document.querySelector(selector);
function showError(message) { $('#error').textContent = message; $('#error').hidden = false; }
function render(data) {
  current = data;
  const active = data.active;
  provider = active.provider;
  const source = data.pack.animations[provider][active.state];
  if ($('#avatar').getAttribute('src') !== source) $('#avatar').src = source;
  $('#state-label').textContent = data.labels[active.state];
  $('#cli-name').textContent = provider;
  $('#terminal-title').textContent = `Windows Terminal / ${provider === 'codex' ? 'Codex' : 'Claude'}`;
  $('#character-label').textContent = provider === 'codex' ? '白髮示範角色' : '橘髮示範角色';
  $('#demo-controls').hidden = !data.demo;
  document.querySelectorAll('[data-provider]').forEach(button => button.classList.toggle('selected', button.dataset.provider === provider));
  document.querySelectorAll('[data-state]').forEach(button => button.classList.toggle('selected', button.dataset.state === active.state));
  $('#asset-notice').textContent = data.pack.sourceKind === 'procedural-svg-demo' ? '原創向量示範角色 · 可換成 Live2D 匯出的動畫素材包' : data.pack.name;
  $('#background-status').textContent = data.background.attached ? '已連接 Windows Terminal 背景' : '預覽模式 · 尚未更動終端設定';
}
async function submit(body) {
  $('#error').hidden = true;
  try {
    const response = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, ...body }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '無法更新預覽');
    render(data);
    if (body.text !== undefined) $('#sample-reply').textContent = body.text;
    else $('#sample-reply').textContent = { thinking: '我先確認問題的來源。', working: '正在修改程式並執行檢查…', happy: '全部測試通過，已完成修復。', concerned: '目前還有兩個測試失敗，尚未修復。', waiting: '請先確認要使用哪一種登入方式。', explaining: '這個函式會先驗證輸入，接著更新畫面。', idle: '正在等待新的對話。' }[body.state] ?? '';
  } catch (error) { showError(error.message); }
}
document.querySelectorAll('[data-state]').forEach(button => button.addEventListener('click', () => submit({ state: button.dataset.state })));
document.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', () => { provider = button.dataset.provider; submit({ state: 'idle' }); }));
document.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => { $('#reply').value = button.dataset.sample; submit({ text: button.dataset.sample }); }));
$('#reply-form').addEventListener('submit', event => { event.preventDefault(); submit({ text: $('#reply').value }); });
const stream = new EventSource('/api/events');
stream.onopen = () => { $('#connection').textContent = '本機連線中'; };
stream.onmessage = event => { try { render(JSON.parse(event.data)); } catch { showError('收到無效的預覽資料'); } };
stream.onerror = () => { $('#connection').textContent = '重新連線中'; };

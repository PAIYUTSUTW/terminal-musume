# 真實 session 驗證

本輪在 Windows Terminal 1.24.12741.0、WSL Ubuntu、tmux 3.4 上測試 Codex 0.163.0 與 Claude Code 2.1.285。測試台詞明確標示為 avatar integration test；模型說的「All tests passed」是指定的分類測試句，不代表模型執行了專案測試。

## 結果

- Codex：真正的 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、Interrupt 均收到。回覆內容能觸發 happy、concerned、waiting；一般終端與 tmux 分頁獨立，inactive pane 不接管背景，切 pane 後顯示它的狀態。
- detach 後從新的 Terminal 分頁 reattach，run 與 LLM session ID 均維持一致。
- `/new` 在送出第一則提示時才建立新 session；同一 wrapper 觀察到新的 SessionStart 與 session ID，後續回覆正確綁定。
- 中斷後回到 idle，wrapper 與 run 保持存活。
- Claude：SessionStart、UserPromptSubmit、StopFailure 正確到達。測試請求遇到帳號用量上限，已取消自動重試；正常 Stop 回覆與成功表情尚待補測。
- npm test：51 通過。首次回歸抓到 v1 測試讀取設定檔過早，已將等待條件改成狀態、背景寫入、事件佇列皆完成後再斷言；修正後通過。

完整結果與真實回覆錄影保留在本機 `artifacts/native-verification.json`、`artifacts/windows-terminal-native.webm`，因含本機路徑與 session 資訊，不隨 repository 公開。公開的 [fixture 展示](media/demo.webm) 使用明確標示的範例回覆。

原生 trust 檢閱只信任本專案以絕對路徑執行的 emit-hook 命令，未使用 bypass flags，未安裝全域 hooks。Codex 的 inline config 會使 CLI 使用 embedded mode，啟動時可看到對應提示；讀取型 shell 工具測試成功。

## 重跑隔離與重連案例

先透過 `musume open` 開啟獨立測試視窗，裡面只放兩個分頁：一個無 tmux 的 Codex，一個連到專用 tmux socket 的分頁。tmux 中分別開 Codex、Claude，各自使用 musume wrapper。完成原生登入／信任流程，讓 Codex 產生一次回覆。測試畫面的 tab title 要含 `Musume Real`，可用 `--title` 設定。

從 `musume status` 取得 target ID，以 `tmux -S SOCKET list-panes` 取得 pane ID，再建立只指向這些測試程序的 descriptor：

```json
{
  "home": "/home/YOUR_USER/.local/state/terminal-musume/v2",
  "socket": "/absolute/path/to/test-only.sock",
  "codex": "%0",
  "claude": "%1",
  "tmuxTarget": "TMUX_TARGET_ID",
  "directTarget": "DIRECT_TARGET_ID",
  "window": "terminal-musume-real",
  "tmuxTabIndex": 0,
  "directTabIndex": 1
}
```

專用 tmux session 名稱使用 `real`，兩個 CLI 停留在可輸入提示的狀態；避免在 direct 分頁反應即將到期時啟動驗證。執行：

```sh
npm run test:native -- --descriptor /absolute/path/to/test-only.json
```

驗證器會送出一則 Codex 測試句、選 pane、擷取視窗、detach 該 tmux client，再以新 profile reattach；同時更新 descriptor 內的 target 與分頁位置。它不代按 trust／登入、不呼叫 Claude、不重試用量上限，也不屬於一般自動化測試。成果寫入 `artifacts/native-real-routing.json`。

預設 runtime descriptor 位於 `~/.local/state/terminal-musume/v2/real-test.json`，不放在 checkout 中。Claude 的正常回覆仍需於有可用額度的帳號上補測。

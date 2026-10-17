# Terminal Musume

依 Codex／Claude Code 的回覆，切換原版 Windows Terminal 的角色背景動畫。角色位於終端文字後方，不占分割窗格。

目前是可執行原型：回覆事件 → 動作判斷 → 切換原生 GIF 背景。**已在 Windows Terminal 1.24.12741.0 實機驗證 GIF 播放與動作切換**。[觀看 fixture 展示](docs/media/demo.webm)。目前使用原創佔位角色，尚未內建第三方角色的 Live2D 模型。

專案授權尚未選定；[MIT 提案](docs/license-proposal.md)與[開源審查](docs/open-source-review.md)已備妥。字型與 npm 依賴的授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本工具為獨立專案。

## 多分頁與 tmux：v0.2

v0.2 支援原版 Windows Terminal + WSL Ubuntu，可同時管理沒有 tmux 的分頁與本機 tmux 3.4。每個分頁使用獨立臨時 profile；同一個控制器序列化設定更新，各個 LLM run、對話 session 與 tmux pane 分別保存狀態。背景中的 pane 完成回覆時不會搶走目前角色，切 pane 才投影該 pane 的狀態。

[觀看 9 秒多分頁／tmux fixture 實機錄影](docs/media/demo.webm) · [tmux 截圖](docs/media/demo.png) · [測試方式](docs/native-testing.md)

2026-10-16 已另測真正的 Codex 0.163.0 模型回覆：思考、工具執行、成功／失敗台詞、等待確認、分頁隔離、切 pane、detach／reattach、`/new` 換 session 及中斷均通過。Claude Code 2.1.285 的 SessionStart、UserPromptSubmit、StopFailure 已收到；測試當時的帳號用量上限使正常回覆尚未測成。原始實錄及紀錄保留在本機 `artifacts/`，不隨 repository 公開。

在 WSL 的本專案目錄執行：

```sh
npm ci --omit=dev
# 開啟獨立 shell 分頁；裡面的 claude / codex / tmux 會使用本工具的 wrappers
node bin/musume.mjs open
# 直接開啟 Claude 或 Codex，保留 -- 後面的原始 CLI 參數
node bin/musume.mjs open --provider claude
node bin/musume.mjs open --provider codex
# 直接進入 tmux；可使用自己的既有 session
node bin/musume.mjs open --mode tmux -- new-session -A -s work
```

預設控制器 runtime 是 `${XDG_STATE_HOME:-~/.local/state}/terminal-musume/v2`，第一次 open 會自動啟動。token、事件、設定備份與 tmux sockets 留在 Linux，不會跟 checkout 一起進入同步資料夾。`--home` 或 `TERMINAL_MUSUME_HOME` 可覆寫位置。使用 `--base-profile 'Ubuntu'` 可指定要複製字型、配色等設定的來源 profile；每個新分頁仍會取得自己的 GUID。分頁結束時清理專用 profile；若你手動修改該 profile，會保留它並在 status 的 `preservedProfiles` 列出，避免刪掉你的修改。

已在執行的 tmux server／pane 可能保留啟動當時的 PATH。可以在要使用角色的既有 pane 載入 wrappers，這只更動該 shell：

```sh
# 把 /path/to/terminal-musume 換成你的 checkout 路徑
eval "$(node /path/to/terminal-musume/bin/musume.mjs env)"
claude
# 或明確指定，不改 PATH
node /path/to/terminal-musume/bin/musume.mjs run --provider codex -- --model YOUR_MODEL
```

外層 Terminal 分頁仍須透過 `musume open` 建立，讓啟動器註冊 tmux client 與獨立 profile。tmux 內部事件以 `server socket + server PID + TMUX_PANE` 定位，忽略 pane 繼承的舊 `WT_SESSION`。detach 後 LLM 可以繼續執行；從另一個 managed 分頁 attach，會重新根據 client 的顯示位置綁定。多 client attach 同一 tmux session 時，遵循 tmux 本身的 window／pane 選擇行為。

Claude 使用 `--settings` 額外載入該次 invocation 的 hooks；Codex 使用 inline hooks config。程式不安裝全域 agent hooks，也不略過原生信任檢閱。**首次啟動時，Codex 需在原生 hooks 畫面檢閱並信任這些命令，Claude 需完成原生工作目錄信任流程**。本次實機測試已檢閱本專案的 emit-hook 命令，再透過原生介面完成信任流程；未使用 bypass 旗標。[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Claude hooks](https://code.claude.com/docs/en/hooks)

管理與驗證：

```sh
node bin/musume.mjs status
node bin/musume.mjs stop
npm run test:v2
# 實機驗證後保留兩個可操作的展示分頁
npm run demo:v2
```

`demo:v2` 使用同一個預設控制器，裡面的回覆是 fixture，經過真實 wrapper、hook 子程序、tmux client、分類與 settings 寫入。`1–6` 切換示範動作；tmux 用 `Ctrl+b` 再按方向鍵選 pane。`Q` 結束該 fixture；tmux server 在 detach 後仍保留，與正常 tmux 一致。驗證器要求目前沒有正式工作的 managed 分頁，避免干擾使用中的 CLI。驗證後保留展示分頁，也可接著用一般 open 命令新增正式分頁。

已實機驗證直接終端與 tmux 背景隔離、pane 切換、非選中 pane 不搶畫面、新分頁 reattach 同一 run、原有八個 profiles 與其他設定完整還原。fixture 實錄採用 Windows `PrintWindow` 擷取真實視窗；後續真實 Codex 回覆實錄使用 `CopyFromScreen`，成功與失敗台詞各擷取 12 幀，另有完整自動化測試與原瀏覽器預覽回歸。

`npm run test:native -- --descriptor /path/to/test-only.json` 可重跑已開啟的專用測試分頁，會送出一則真正的 Codex 請求並執行 detach／reattach，不屬於一般 `npm test`。準備方式與 descriptor 欄位見 [真實 session 驗證](docs/native-testing.md)。

本輪支援範圍是 WSL 本機 tmux。SSH 遠端事件傳輸、原生 PowerShell backend，以及每個 tmux split 各自一張動畫背景尚未實作。外層終端目前以一張背景跟隨所選 pane。Live2D 素材仍留待後續處理。

## 顯示方式

Windows Terminal 原生支援 GIF 背景。本專案只在動作改變時，更新指定 profile 的 `backgroundImage` 路徑；逐格播放由 Windows Terminal 自己處理。不是每一幀修改設定，也沒有在文字區輸出圖像。

現階段採 **Live2D 動作預先匯出 GIF** 的路線。動作會在回覆後切換，無法提供即時 Live2D 的連續表情混合、頭部追蹤或逐音素嘴型。原始 Windows Terminal 尚未提供可直接嵌入這類即時渲染器的通用 UI 插件介面。

內附兩個原創 SVG 示範角色，共 14 段透明 GIF（每段 48 幀、20 FPS）：橘髮示範角色和白髮龍形示範角色。**這些是流程佔位素材，不是原作者立繪，也不是 Live2D 模型。**

## 實機展示（WSL）

在安裝 Microsoft Store Stable 版 Windows Terminal 的 WSL 環境中執行：

```sh
npm ci --omit=dev
npm run demo:windows
```

啟動器會建立獨立展示 profile，把素材複製到 Windows 本機的 `%LOCALAPPDATA%\TerminalMusumeDemo\assets`，並開啟真正的 Windows Terminal 視窗。原有 profiles 與預設 profile 保留。WSL 未註冊 EXE binfmt 時，啟動器可透過 `/init` 執行 Windows PowerShell，不需要修改 WSL 系統設定。

- `Space`：暫停／繼續循環。
- `N`：下一個動作；`1` 到 `0`：指定十個展示步驟。
- `Q` 或 `Ctrl+C`：結束、還原外觀並移除專用展示 profile。

畫面中的回覆是明確標示的範例，經過真正的 hook 子程序、本機事件佇列、回覆分類及設定檔更新；不會啟動模型推論，也不會自動安裝 agent hooks。素材可見度為 52%，位於終端文字後方。

實機錄影工具是 `npm run record:windows`，需要展示視窗正在執行，以及 FFmpeg 的 MJPEG 解碼與 VP9 編碼支援。可透過 `TERMINAL_MUSUME_FFMPEG` 指定執行檔；預設使用本機 Playwright 的 FFmpeg。錄影期間會暫時把展示視窗置頂，結束後取消置頂。

## 瀏覽器快速預覽

需要 Node.js 22 以上。下載包已有 GIF；只執行程式時不必安裝繪圖與瀏覽器測試工具。

```sh
npm ci --omit=dev
npm start
```

開啟 <http://127.0.0.1:7331>。可切換角色、試播動作、輸入回覆。此模式不修改 Windows Terminal 或兩個 agent 的設定。

## 連接 Windows Terminal 背景

先在 Windows Terminal 設定中開啟 JSON 檔，確認你實際使用的 `settings.json`。Stable、Preview、Canary、便攜版各有不同位置。以下 PowerShell 範例使用 Microsoft Store Stable 版：

```powershell
$terminalSettings = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'
node bin/terminal-musume.mjs profiles --settings $terminalSettings
```

從輸出選擇要測試的 profile GUID，接著啟動：

```powershell
node bin/terminal-musume.mjs start --demo --settings $terminalSettings --profile '{你的-profile-GUID}'
```

瀏覽器中的動作按鈕此時會同步切換該 profile 的原生背景。Ctrl+C 會還原本工具管理的外觀欄位；啟動前的完整設定備份位於 v1 runtime 的 `backups/`，預設是 `~/.local/state/terminal-musume/backups/`。若你在執行中手動修改外觀，結束時會保留與本工具最後寫入值不同的欄位。

如果使用 WSL，請在同一個 WSL 環境執行 bridge 和 hooks，將 `--settings` 指向 `/mnt/c/Users/.../settings.json`。資產位於 `/mnt/c` 時會轉成磁碟機路徑，位於 WSL 檔案系統時會使用 `WSL_DISTRO_NAME` 產生 UNC 路徑；也可用 `--windows-pack-root 'C:\path\to\the\same\pack'` 明確指定 Windows 看到的同一個素材目錄。

這個舊版單分頁模式以 **profile** 為範圍，同一 profile 的分頁會一起改變。多 session 請使用上方 v0.2 的 `musume open`，由一個控制器管理多個獨立 profiles。啟用全視窗背景 `useBackgroundImageForWindow` 的配置會被明確拒絕。

## 接收真實回覆

在 **agent 所在的環境** 產生 hooks 片段：

```sh
node bin/terminal-musume.mjs hooks --provider codex
node bin/terminal-musume.mjs hooks --provider claude
```

它們使用絕對路徑，包含 `SessionStart`、`UserPromptSubmit`、工具狀態、等待輸入，以及 `Stop` 等事件。

- **Codex**：將產生的 `hooks` 事件合併進 `~/.codex/hooks.json`，或專案的 `.codex/hooks.json`。保留原有事件與 handler，避免直接覆蓋整份設定。依 official OpenAI documentation，新增的非受管理 hooks 需要在 Codex `/hooks` 中檢閱與信任後才會執行。
- **Claude Code**：將產生的 `hooks` 事件合併進 `~/.claude/settings.json`，或專案的 `.claude/settings.json`，保留原有設定，再重新開始一個 session。

此步驟沒有自動執行；本專案不會自行安裝或改寫現有 agent hooks。若 bridge 使用自訂 `--home`，產生 hook 片段時也要帶相同的 `--home`。

也可先手動模擬一個完成回覆：

```sh
node bin/emit-hook.mjs --provider codex --event Stop --text '全部測試通過，沒有錯誤。'
```

Hook 將事件暫存到本機 runtime 的 `inbox/`，bridge 讀取後即刪除。狀態快照不保留回覆文字。Hook 永遠回傳空 JSON，不改寫 agent 回覆、工具參數或繼續執行的決策。正常情況下顯示判斷在回覆結束後發生；這版沒有擷取生成中的完整串流。

## 回覆與動作

| 情況 | 動作 |
|---|---|
| 開始處理提示 | thinking |
| 執行工具 | working |
| 「全部測試通過，沒有錯誤」 | happy |
| 「已修好，但還有測試失敗」 | concerned |
| 「請先確認／提供／選擇」 | waiting |
| 中性說明 | explaining |
| 無活動、反應播完 | idle |

預設使用可檢查的中英文字詞規則，能處理一些否定句和混合結果，但不是完整自然語言理解。若已安裝本機 Ollama 模型，可啟用語意分類：

```sh
node bin/terminal-musume.mjs start --demo --ollama-model '你已安裝的模型名稱'
```

它只傳送回覆文字到本機 Ollama，不需要 OpenAI API key。可回傳的動作有限定，1.6 秒逾時、無法連線或輸出不合法時使用規則判斷。此介面以模擬服務測過；尚未以真實 Ollama 模型驗證分類品質。

## 換成真正的角色

先取得橘髮 Claude 娘和白髮龍娘的 Live2D 模型，或請模型製作者匯出各動作的透明背景 GIF。保留素材來源與使用條件。

複製 `assets/demo/pack.json` 的結構，將路徑換成你的 GIF：

```json
{
  "version": 1,
  "name": "My Live2D render pack",
  "sourceKind": "live2d-prerender",
  "providers": {
    "claude": { "idle": "claude/idle.gif", "happy": "claude/happy.gif" },
    "codex": { "idle": "codex/idle.gif", "happy": "codex/happy.gif" }
  }
}
```

支援 `idle / thinking / working / happy / concerned / waiting / explaining`。缺少的動作會退回該角色的 idle。每張 GIF 必須位於素材包內。用 `--pack <素材包目錄>` 啟動即可套用；目前還沒有自動把 `.model3.json` 轉成 GIF 的 exporter。

預設原生顯示使用自然尺寸、右下對齊、28% 不透明度，文字位於背景上方。透明 GIF 只有 1-bit alpha，邊緣與配色品質會低於即時 Live2D；可以針對終端底色預先輸出以改善邊緣。

## 驗證

完整開發依賴：`npm ci`。

```sh
npm test
npm run check
# 重建示範 GIF
npm run assets
# 另一個終端先執行 npm start
npx playwright install chromium
npm run test:preview
```

已驗證：54 項自動化測試（含真正的 hook 子程序 → 本機事件佇列 → 回覆判斷 → JSONC 背景更新 → 原設定還原，以及多 session／tmux 路由、repo 外的 runtime 存放位置）、14 段 GIF 的素材完整性，以及瀏覽器的動作切換、透明度、事件推送與動畫播放。

2026-10-15 於實際 Windows Terminal 1.24.12741.0 驗證兩個角色的 thinking、happy、concerned：每個狀態擷取 24 幀，均有至少 20 個不同畫面。18 秒 fixture 實錄、六張狀態截圖與 本機 `artifacts/windows-terminal-verification.json` 位於 `artifacts/`。關閉展示後也驗證原有八個 profiles 及其餘設定完整還原。2026-10-16 的真實模型測試另見 本機 `artifacts/native-verification.json`；Claude 正常回覆仍待帳號用量恢復。

Windows Terminal 的設定檔沒有跨程式 compare-and-swap 介面。本工具在寫入前會重讀檢查、建立鎖與還原紀錄，但無法完全消除其他程式同時寫設定的競爭。第一版應先用測試 profile 驗證。

## 依據

- [Windows Terminal 背景設定](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/profile-appearance)
- [Windows Terminal 背景圖片 URI 改變時重新載入的實作](https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalControl/TermControl.cpp)
- [官方通用第三方擴充追蹤](https://github.com/microsoft/terminal/issues/4000)
- [Official OpenAI documentation：Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code hooks：Stop 與 last_assistant_message](https://code.claude.com/docs/en/hooks#stop)

# 開源可行性審查

檢查日期：2026-10-17。結論：**目前內容具備開源條件，正式開源前仍需選定並套用專案授權。** 尚未建立公開遠端 repository 或執行 npm 發布。

## 授權與素材

公開候選內容包含原創程式、程序式 SVG 角色及 GIF。工作目錄另有兩個指向外部角色專案的本機符號連結，分別位於 `assets/live2d/` 與 `assets/references/`；外部素材的授權尚未驗證，因此保留本機連結，但整個目錄排除於 Git 與套件。公開內容沒有附帶第三方模型或 Cubism runtime。建議本專案採 MIT，提案見 [license-proposal.md](license-proposal.md)。

Noto Sans TC 子集保留完整 OFL-1.1 與版權聲明。依 `package-lock.json`，npm 依賴使用 MIT、MPL-2.0、Apache-2.0；沒有把它們的原始碼或 native binaries 加入 repository。MPL 元件若將來隨二進位發行，仍需處理相應的原始碼提供資訊。[第三方清單](../THIRD_PARTY_NOTICES.md)記錄版本、用途及來源。

本工具是獨立的相容性原型；產品名稱的提及不表示原廠背書。未來的第三方角色圖與 Live2D 模型須另行檢查散布權限。

## 公開檔案範圍

Git 候選內容包含程式碼、測試、公開說明、14 段原創 GIF、字型及其授權，以及一段不含真實帳號對話的 fixture 展示。

以下內容保留於本機且排除於 Git：`node_modules/`、`artifacts/`、舊 `.runtime/`、內部 `docs/tickets/` 交接紀錄、`assets/live2d/` 與 `assets/references/` 外部素材連結，以及環境檔、私鑰和 log。舊 `artifacts/` 包含真實 session ID、機器路徑、帳號狀態畫面及歷史 ZIP，不作為公開發行包。

控制器 token、事件佇列、Windows Terminal 設定備份與 tmux sockets 的預設位置改為 WSL/Linux 的 `$XDG_STATE_HOME/terminal-musume`，未設定時使用 `~/.local/state/terminal-musume`。專案搬到 Windows 硬碟後，這些執行資料仍留在 Linux；`--home` 或 `TERMINAL_MUSUME_HOME` 可明確覆寫。

Git 候選文字內容已檢查常見 API key、GitHub token、AWS access key、私鑰與本機私人路徑。沒有發現這些模式的實際憑證；控制器測試中的 token 變數與範例不屬於實際憑證。模式檢查不能保證找出所有種類的秘密。

## 第二次發布內容檢查

另外使用官方發行、已核對 SHA-256 的 [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks) 檢查候選原始碼與 ZIP。83 個候選檔案沒有發現憑證；候選包逐檔與 Git index 比對。專案尚無 commit 歷史或遠端 refs；本機未被 commit 引用的舊暫存物件也未發現憑證，但 `.git` 本機資料不屬於原始碼 ZIP。

本次移除公開測試說明中的帳號重置時刻、時區及特定本機 MCP 錯誤細節，保留「Claude 正常回覆尚待補測」的結果。新增本機 npm／agent 憑證檔的忽略規則，既有外部角色連結繼續排除。

公開 PNG 沒有文字、EXIF 或 XMP 附加資料；字型 name table 沒有個人路徑；WebM 僅有編碼器與影片長度 metadata，沒有音軌。9 秒影片的 36 幀已解碼檢視，內容為 fixture 展示。14 段 GIF 在隔離目錄重新匯出後逐檔相同，且沒有 GIF comment blocks。

**不要把整個開發資料夾或舊 `artifacts/terminal-musume-prototype.zip` 上傳。** 舊包有 15 個文字檔含私人路徑、真實 session 測試紀錄或帳號環境細節，已排除 Git。應使用審查後的 Git 候選內容或重新產生的 `artifacts/terminal-musume-source-candidate.zip`。正式以開源授權發布前，仍須選定並套用根目錄 `LICENSE`；目前維持 `UNLICENSED`。

## 驗證

- 搬移前後 345 個原有檔案／連結完成 SHA-256 或連結目標比對。
- 從新的 checkout 執行自動化測試：54 項通過，包含新增的 runtime 存放位置與覆寫相容性。
- 再從 Git index 匯出乾淨的候選原始碼，獨立執行 `npm ci` 與全部 54 項測試，均通過；不依賴本機 runtime、外部角色素材或舊 node_modules。直接執行的 CLI 與 demo hook 腳本保留 executable 權限。
- `npm run check`：14 個透明 GIF slots 與 manifest 通過。
- 從搬移後的 checkout 重跑 Windows Terminal 實機展示：direct／tmux 隔離、切 pane、detach／reattach 通過；結束後原有 8 個 profiles 與其餘設定完整還原。公開 fixture 示範已重新擷取，tmux footer 不顯示機器 hostname。
- `npm pack --dry-run`：48 個套件檔案；沒有執行資料、個人測試紀錄或 node_modules，字型 OFL 與 runtime helper 均包含。
- `npm audit`：本次 registry 回覆 0 個已知漏洞，包含開發依賴；這是當次已知漏洞資料的結果。
- 本次檢查以 WSL Ubuntu 與本機 tmux 為範圍；原生 PowerShell backend、SSH 遠端事件傳輸與實際 Live2D renderer 尚未完成。
- 真實 Codex session 已驗證過動作與路由。先前 Claude 正常回覆因帳號用量上限未完成，不能把 fixture 結果當成 Claude 推論驗證。

詳細的個人測試原始紀錄只保留在本機 `artifacts/`。授權來源：[MIT](https://opensource.org/license/mit)、[OFL](https://openfontlicense.org/open-font-license-official-text/)、[MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。

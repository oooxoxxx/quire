# Quire

原始碼：<https://github.com/oooxoxxx/quire>

Quire（啟記）是一個本地優先的私人日記。它參考 Apple Journal 的簡潔閱讀方式：時間軸、同一天多篇、心情、地點、照片與聲音。日記先存在你的裝置裡。要跨裝置時，同步到**你自己的 Google Drive**，不是 Quire 的伺服器。

這不是 Apple 的產品，也不使用 Apple 的商標或程式。

## 你可以用它做什麼

- 寫日記：標題、富文字、心情、標籤、自訂日期、收藏、地點。
- 附件：照片、影片、錄音。圖片會在存入前盡量壓縮。
- 離線書寫。安裝到主畫面後，已開啟過的畫面可以在沒有網路時打開。
- 搜尋、日曆、往年今日。
- 匯出 JSON、Markdown、HTML、列印／PDF、ZIP 備份。
- 匯入 Quire 備份，或 Apple Journal 匯出的 `AppleJournalEntries.zip`。
- 可選 PIN 鎖定，並用 PIN 衍生的金鑰以 AES-256-GCM 加密本機日記。
- 可選雲端密碼。上傳前再加密一層。密碼不會寫進備份檔。

## 安裝與本機開發

需要 Node.js 22。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local` 只有一個可選值：`VITE_GOOGLE_CLIENT_ID`。這是 Google Cloud「網頁應用程式」OAuth 用戶端的**用戶端 ID**。不要建立、也不要貼上用戶端密鑰。沒有這個值也可以完整使用本機日記與匯入匯出；連線 Google Drive 時再在設定頁貼上即可。

```bash
npm test
npm run typecheck
npm run build
```

## 部署

本機預覽與 Vercel 仍用 `npm run build`（含伺服器）。公開網頁用 GitHub Pages，那是一份不含伺服器的靜態站：

```bash
npm run build:pages
```

產物在 `dist/client`。正式站是 <https://oooxoxxx.github.io/quire/>。推上 `main` 後，GitHub Actions 的 Pages 工作流程會建置並發布。

日記仍只存在瀏覽器裡。GitHub Pages 沒有 Quire 的後端，Google Drive 同步一樣直接連你的 Google 帳號。OAuth 的「已授權 JavaScript 來源」要加上 `https://oooxoxxx.github.io`。

## 部署到其他主機

這是靜態優先的 PWA（TanStack Start）。建置：

```bash
npm run build
```

部署到任何可以託管該建置結果的靜態或 Node 主機。若使用 Vercel，保留專案裡的 `vercel.json`。

Google OAuth 的「已授權的 JavaScript 來源」必須包含你實際開啟 Quire 的網址（含預覽網址與正式網址）。範圍是 `https://www.googleapis.com/auth/drive.appdata` 與 `https://www.googleapis.com/auth/drive.file`。Quire 只用這兩個範圍：隱藏的應用程式資料夾，以及你另外打開「可見備份」時建立的 `Quire Backups` 資料夾。

## Google Drive 同步

1. 在 Google Cloud Console 建立專案，啟用 Google Drive API。
2. 設定 OAuth 同意畫面。測試階段請把你的 Google 帳號加進測試使用者。
3. 建立「網頁應用程式」用戶端 ID。已授權的 JavaScript 來源填網站網址。
4. 在 Quire 設定貼上用戶端 ID，按「連接 Google Drive」。
5. 可打開自動同步。離線時所做的修改會在網路恢復後再送出。

同步是增量的：每篇日記與每個附件有修訂號。兩台裝置同時改同一篇時，設定頁會請你選擇留下這台、留下另一台，或兩邊都留。

雲端加密要在每台裝置用同一組備份密碼解鎖後才會上傳或下載。忘記密碼就無法讀取已加密的雲端副本；本機若尚未加密，日記仍在這台裝置上。

## 備份與還原

- **JSON / ZIP**：完整還原用。ZIP 把附件放在 `attachments/`。
- **加密 ZIP**：還原時輸入備份密碼。
- **Markdown / HTML / PDF**：給人讀，不保證能無損匯回。
- **可見資料夾**：設定裡打開後，每次同步會在 Google Drive 的 `Quire Backups` 放一份 ZIP。

還原會依日記 ID 合併。相同 ID 以檔案內容更新這台裝置。請先匯出一份目前的 ZIP，再還原別的備份。

## Apple Journal

Quire 可以讀取公開轉換器描述過的匯出結構：

- `Entries/*.html`（標題、內文、日期、地點、心情）
- `Resources/` 裡的照片、影片、聲音，以及旁邊的 JSON

匯入前會顯示預覽、可匯入數量、重複與失敗。同一份檔案再匯一次會略過已存在的來源。

Quire 也能做出結構相近的 ZIP。**Apple 沒有提供第三方匯入 API，不能保證這份 ZIP 可以重新匯入 Apple Journal。** 解析器也還沒用你手上的真實匯出檔做過官方驗證。若預覽把某一篇標成失敗，那一篇不會被假裝匯入。

資料頁的「模擬 ZIP」只是開發用樣本，不是從 Apple 裝置匯出的檔案。

## 隱私

- 預設不送出日記。
- 沒有帳號系統、沒有廣告、沒有追蹤。
- 日記內容不會送到任何 AI 服務。
- 查詢地名是可選的，會把座標送到 OpenStreetMap。不想送出就自己打地名。
- PIN、本機金鑰與雲端密碼只在這台瀏覽器裡算出，不會放進原始碼或 GitHub。

## 資料格式

每篇日記有穩定的 `id`，以及 `schemaVersion`。目前是版本 1。往後若格式升級，會在讀取時遷移，不會悄悄丟掉舊檔。

## 授權

MIT。見 [LICENSE](LICENSE)。

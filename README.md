# 學書

在每日書寫中學會草書 —— 每天寫下一句話（或從唐詩三百首選句），逐字入課：
生字現學（描紅 → 盲寫 → 認字），熟字默寫，FSRS 間隔重複排期。
全站繁體 · 水墨雙世界設計（宣紙瀏覽 / 入墨練習）。

**正式版本只有一個：GitHub Pages 靜態版 `https://fengjh97.github.io/caoshu/`。**
盲寫判定為對照範本自評；數據存瀏覽器 localStorage（設置頁可導出/導入 JSON 備份）；
真跡用預抓清單 + 圖床 no-referrer 直連。

Flask 完整版（`app.py`：Gemini 打分 + Mac SQLite + 真跡實時代理）已退役，
僅留作本地開發調試用，不再常駐。

## 核心玩法

- **每日一句**：自寫短句，逐字考草書；沒學過的字當天現學 —— 在實際使用中積累。
- **唐詩模式**：寫不出句子時從《唐詩三百首》（320 首，繁體）選句或整首，
  推薦算法按「每日生字目標」挑生字量合適的詩；學會的句子日後可整句草書創作。
- **複習頁**：已學字的認字快練 + 點字重寫。
- **名家真跡**：每字學完即看歷代名家的多種寫法 —— 用草書理解草書。

## 架構

- `static/` —— 無框架單頁前端（引擎抽象層 `js/engine.js` 雙模式：server / static）。
  靜態模式內置 FSRS-4.5 調度（`js/fsrs.js`）；毛筆筆刷引擎 `js/brush.js`
  （彈簧筆鋒 + 速度僞壓感 + stamp 鏈 + 多絲飛白 + 墨量衰減，頭注有原理）。
  設計系統見 `app.css` 頭注；全站字體霞鶩文楷 TC（CDN 分片加載），草書字形鍾齊流江毛草。
- `app.py` —— （退役，僅開發用）Flask 單文件後端。
- `data/chars.json` —— 3574 字庫：基礎 3000（字頻序）+ 574 詩字擴展（`poem` 標記，
  唐詩三百首用字 · 草書字體有字形才收，僅 52 生僻字捨棄）。含拼音與 `tc` 繁體顯示形；
  內部 id 與草書字體碼位優先簡體（字體無簡體字形時用繁體碼位並存 `sc` 別名）。
- `data/decompositions.json` —— 前 500 高頻字的草書符號拆解 / 楷草演變 / 易混字（文案已轉繁體）。
- `data/poems.json` —— 唐詩三百首（源 chinese-poetry，已剝校勘注）。
- `docs/` —— Pages 靜態版構建產物（`scripts/build_pages.py` 生成，勿手改）。

## 常用命令

```bash
.venv/bin/python scripts/build_chars.py          # 重建字庫（跑完必須再跑 build_tc.py 補繁體）
.venv/bin/python scripts/build_tc.py             # 繁體字段 + 拆解轉繁 + 唐詩三百首
.venv/bin/python scripts/prefetch_manifests.py   # 補抓真跡清單（冪等，限速 4-6s，別改快）
.venv/bin/python scripts/build_pages.py          # 重建 docs/（然後 commit + push 即部署）
.venv/bin/python app.py                          # （開發調試）本地跑 Flask 版，PORT=8873
```

冒煙測試見 `scripts/webtests/README.md`（無頭 Chrome 端到端：引擎鏈路 + 完整用戶流）。

用戶數據目錄（Flask 版 SQLite / config / 真跡清單緩存）在
`~/Library/Application Support/Caoshu/data`（`CAOSHU_DATA_DIR` 可覆寫）——
放 Documents 外是因爲 macOS TCC 會擋住後台進程。真跡預抓也寫到這裏，
`build_pages.py` 從這裏取清單打進 `docs/`。

## 學習機制

- 每字兩張卡：認字（草→楷四選一）與書寫（楷→草：新卡先描紅、後盲寫）。
- 新字只由「每日一句 / 唐詩選句」引入（不再按字頻自動灌入）；FSRS 排期複習。
- 「每日生字目標」（設置頁）用於唐詩推薦選詩，默認 10。
- 靜態版數據在瀏覽器本機，設置頁可導出 / 導入 JSON 備份。

## 注意

- 真跡來源 shufazidian.com：搜索接口對高頻請求會臨時封禁（≈0.8s 間隔百餘次即觸發，
  封禁表現爲全 500），預抓腳本已內置 4-6s 隨機限速與連敗熔斷，不要調快。
- 詩句繁體 → 字庫靠 `tc`/`sc` 映射；唐詩用字僅 52 個因字體無字形不可學，UI 標「缺」跳過。
- 字體：鍾齊流江毛草（OFL）基礎子集 956KB + 詩字擴展包 433KB（unicode-range 按需加載，
  勿用本地管線重生成基礎包——比 Google Fonts 優化輪廓大一倍）；霞鶩文楷 TC 走 jsdelivr CDN。

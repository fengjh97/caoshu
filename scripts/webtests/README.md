# Web 冒煙測試

無頭 Chrome 跑的端到端測試（構建後把文件拷進 docs/ 同源執行，跑完刪除）：

```bash
.venv/bin/python scripts/build_pages.py
cp scripts/webtests/test-*.html docs/
( cd docs && python3 -m http.server 8123 & )
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --dump-dom --virtual-time-budget=40000 \
  http://localhost:8123/test-flow.html 2>/dev/null | grep -Eo '(OK|FAIL|ERROR)[^<]*'
rm docs/test-*.html
```

- `test-engine.html`：LocalEngine 單元鏈路（FSRS 評分 / isStarted / 選項 / 詩庫 / 繁簡映射 / 備份導入導出）
- `test-flow.html`：完整用戶流（設今日一句 → 入墨描紅盲寫（真實 pointer 事件驅動筆刷）→ 自評 → 認字跟卡 → FSRS 入冊 → 唐詩選句）

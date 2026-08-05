# 草書 · 入墨

草书认字与手写练习 —— 「草书版多邻国 + Anki」。
三千字库 · 一千常用字学习集 · FSRS 间隔重复 · 水墨双世界设计（宣纸浏览 / 入墨练习）。

**正式版本只有一个：GitHub Pages 静态版 `https://fengjh97.github.io/caoshu/`。**
盲写判定为对照范本自评；数据存浏览器 localStorage（设置页可导出/导入 JSON 备份）；
真迹用预抓清单 + 图床 no-referrer 直连。

Flask 完整版（`app.py`：Gemini 打分 + Mac SQLite + 真迹实时代理）已退役，
仅留作本地开发调试用，不再常驻。

## 架构

- `static/` —— 无框架单页前端（引擎抽象层 `js/engine.js` 双模式：server / static）。
  静态模式内置 FSRS-4.5 调度（`js/fsrs.js`）。设计系统见 `app.css` 头注。
- `app.py` —— （退役，仅开发用）Flask 单文件后端：SQLite +
  [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs)，代理 Gemini 与书法字典真迹。
- `data/chars.json` —— 3000 字库（字频序，含拼音），`core` 标记 1000 常用学习字
  （《通用规范汉字表》一级字表 ∩ 字频前列，由 `scripts/build_chars.py` 生成）。
- `data/decompositions.json` —— 前 500 高频字的草书符号拆解 / 楷草演变 / 易混字。
- `docs/` —— Pages 静态版构建产物（`scripts/build_pages.py` 生成，勿手改）。

## 常用命令

```bash
.venv/bin/python scripts/build_chars.py          # 重建字库
.venv/bin/python scripts/prefetch_manifests.py   # 补抓真迹清单（幂等，限速 4-6s，别改快）
.venv/bin/python scripts/build_pages.py          # 重建 docs/（然后 commit + push 即部署）
.venv/bin/python app.py                          # （开发调试）本地跑 Flask 版，PORT=8873
```

用户数据目录（Flask 版 SQLite / config / 真迹清单缓存）在
`~/Library/Application Support/Caoshu/data`（`CAOSHU_DATA_DIR` 可覆写）——
放 Documents 外是因为 macOS TCC 会挡住后台进程。真迹预抓也写到这里，
`build_pages.py` 从这里取清单打进 `docs/`。

## 学习机制

- 每字两张卡：认字（草→楷四选一）与书写（楷→草：新卡先描红、后盲写）。
- FSRS 排期，每日新卡上限默认 10（设置页可调），按字频序引入。
- 判定只看字形结构相似度（容错高，不计笔锋）；score ≥ 70 为 pass。
- 静态版数据在浏览器本机，设置页可导出 / 导入 JSON 备份。

## 注意

- Gemini key 存用户数据目录的 `config.json`（设置页填入），静态版完全不含 key。
- 真迹来源 shufazidian.com：搜索接口对高频请求会临时封禁（≈0.8s 间隔百余次即触发），
  预抓脚本已内置 4-6s 随机限速与连败熔断，不要调快。
- 字体：钟齐流江毛草（OFL），Pages 版只带 3000 字子集 woff2（956KB）。

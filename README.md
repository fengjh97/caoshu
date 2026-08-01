# 草書 · 入墨

草书认字与手写练习 —— 「草书版多邻国 + Anki」。
三千字库 · 一千常用字学习集 · FSRS 间隔重复 · 水墨双世界设计（宣纸浏览 / 入墨练习）。

两个版本，一套前端：

| | 完整版（Mac 本地服务） | 静态版（GitHub Pages） |
|---|---|---|
| 地址 | `http://192.168.0.16:8873`（局域网）/ Tailscale `http://100.110.120.23:8873` | `https://fengjh97.github.io/caoshu/` |
| 盲写判定 | Gemini 多模态打分 | 对照范本自评 |
| 数据 | Mac SQLite（跨设备同一份） | 浏览器 localStorage（可导出/导入备份） |
| 真迹 | 后端实时代理 + 缓存 | 预抓清单 + 图床直连 |

## 架构

- `app.py` —— Flask 单文件后端：SQLite + [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs)，
  代理 Gemini（`gemini-3.1-pro-preview`）与书法字典真迹。
- `static/` —— 无框架单页前端（引擎抽象层 `js/engine.js` 双模式：server / static）。
  静态模式内置 FSRS-4.5 调度（`js/fsrs.js`）。设计系统见 `app.css` 头注。
- `data/chars.json` —— 3000 字库（字频序，含拼音），`core` 标记 1000 常用学习字
  （《通用规范汉字表》一级字表 ∩ 字频前列，由 `scripts/build_chars.py` 生成）。
- `data/decompositions.json` —— 前 500 高频字的草书符号拆解 / 楷草演变 / 易混字。
- `docs/` —— Pages 静态版构建产物（`scripts/build_pages.py` 生成，勿手改）。

## 常用命令

```bash
.venv/bin/python app.py                          # 本地跑（PORT=8873）
.venv/bin/python scripts/build_chars.py          # 重建字库
.venv/bin/python scripts/build_pages.py          # 重建 docs/（然后 commit + push 即部署）
.venv/bin/python scripts/prefetch_manifests.py   # 补抓真迹清单（幂等，限速 4-6s，别改快）
```

launchd 常驻：`launchd/com.nianian.caoshu.plist` → `~/Library/LaunchAgents/`。

## 学习机制

- 每字两张卡：认字（草→楷四选一）与书写（楷→草：新卡先描红、后盲写）。
- FSRS 排期，每日新卡上限默认 10（设置页可调），按字频序引入。
- 判定只看字形结构相似度（容错高，不计笔锋）；score ≥ 70 为 pass。
- 静态版数据在浏览器本机，设置页可导出 / 导入 JSON 备份。

## 注意

- Gemini key 存 `data/config.json`（gitignore），静态版完全不含 key。
- 真迹来源 shufazidian.com：搜索接口对高频请求会临时封禁（≈0.8s 间隔百余次即触发），
  预抓脚本已内置 4-6s 随机限速与连败熔断，不要调快。
- 字体：钟齐流江毛草（OFL），Pages 版只带 3000 字子集 woff2（956KB）。

# 草书 Web

草书版多邻国 + Anki，Web 端。iOS 版（`~/projects/caoshu-app`）的移植：
手机浏览器手指书写，Mac 本机跑 Flask 后端，Tailscale 出门也能用。

## 架构

- **后端** `app.py`：Flask 单文件。SQLite（`data/caoshu.db`）存卡片与复习日志，
  [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) 调度，代理 Gemini
  手写判定（`gemini-3.1-pro-preview`）与书法字典（shufazidian.com）真迹抓取。
- **前端** `static/`：无框架单页（HTML/CSS/JS），PWA 可加到主屏幕。
  水墨设计语言移植自 iOS 版 `Theme.swift`。
- **数据** `data/`：`hanzi_freq.json` / `decompositions.json` 各 500 高频字
  （Gemini 预生成拆解），来自 iOS 版资源。

## 运行

```bash
.venv/bin/python app.py          # http://localhost:8873
```

launchd 常驻（开机自启）：`launchd/com.nianian.caoshu.plist` → `~/Library/LaunchAgents/`。

手机访问：同 Wi-Fi 用 Mac 局域网 IP，出门走 Tailscale（`http://xiaojingimac:8873`
或 `http://100.110.120.23:8873`）。

## 配置

设置页粘贴 Gemini API Key（存 `data/config.json`，不进 git）。无 key 时盲写
判定降级为自评，其余功能全可用。

## 学习机制

- 每字两张卡：认字（草→楷 四选一）+ 书写（楷→草 描红→盲写→Gemini 判定）。
- FSRS 间隔重复，每日新卡上限默认 10（设置页可调），按字频序解锁。
- 判定只看字形结构相似度（容错高，不计笔锋）；score≥70 为 pass。

"""預抓真跡清單（草書單字圖，含書法家署名）→ 用戶數據目錄 calligraphy/。

數據源：shufa.guoxuedashi.com —— 碼點即 URL（https://shufa.guoxuedashi.com/{HEX}/3/，
3=草書），無需搜索接口，實測無明顯限流；每字約 20-30 張，title="字,書法家"。
圖床 pic.39017.com:447 要求「非空 Referer + 瀏覽器 UA」但不校驗域名——
前端從 Pages 熱鏈時瀏覽器默認發 referer，能正常出圖（千萬別加 no-referrer）。

清單格式：[{"u": 圖片URL, "by": 書法家}]（舊版曾是純 URL 數組，前端兼容兩種）。
繁簡碼點分頁各有內容：kai 與 tc 不同時兩頁都抓、合併去重。

歷史備註：舊源 shufazidian.com 的 s.php 限流極狠（一陣只放兩三個請求）且
sort 碼易錯（7=草書 8=行書 9=楷書），已棄用。
"""

from __future__ import annotations

import json
import os
import random
import re
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = Path(
    os.environ.get(
        "CAOSHU_DATA_DIR",
        Path.home() / "Library" / "Application Support" / "Caoshu" / "data",
    )
)
OUT = DATA / "calligraphy"
OUT.mkdir(parents=True, exist_ok=True)

# WAF 做指紋一致性校驗：curl 的 TLS 指紋配完整 Chrome UA 會被餵空頁，
# 配樸素 UA 反而放行。別「升級」這個 UA。
UA = "Mozilla/5.0"
ALLOWED_IMG = ("39017.com", "guoxuedashi.com", "guoxuedashi.net")
MAX_IMAGES = 12

IMG_RE = re.compile(r'<img[^>]+src="(https?://[^"]+)"[^>]*title="([^"]+)"')


class FetchError(Exception):
    pass


def http_get(url: str) -> str:
    """經 curl 取頁面。站點 WAF 按客戶端指紋放行：python-requests 從首個請求
    就被餵空 200（隨後連接重置），curl 一直正常——所以傳輸層必須用 curl。"""
    p = subprocess.run(
        ["curl", "-s", "--max-time", "25", "-H", f"User-Agent: {UA}",
         "-w", "\n%{http_code}", url],
        capture_output=True, text=True, timeout=30,
    )
    if p.returncode != 0:
        raise FetchError(f"curl exit {p.returncode}")
    body, _, code = p.stdout.rpartition("\n")
    if code != "200":
        raise FetchError(f"http {code}")
    if len(body) < 1000:
        raise FetchError(f"empty body ({len(body)}B)")
    return body


def allowed(url: str) -> bool:
    m = re.match(r"https?://([^/]+)/", url + "/")
    if not m:
        return False
    host = m.group(1).lower().split(":")[0]
    return any(host == h or host.endswith("." + h) for h in ALLOWED_IMG)


def fetch_page(ch: str) -> list[dict]:
    html = http_get(f"https://shufa.guoxuedashi.com/{ord(ch):04X}/3/")
    out = []
    for u, title in IMG_RE.findall(html):
        if not allowed(u):
            continue
        by = title.split(",", 1)[1].strip() if "," in title else title.strip()
        out.append({"u": u, "by": by})
    return out


def fetch(kai: str, tc: str) -> list[dict]:
    items = fetch_page(kai)
    if tc and tc != kai:
        time.sleep(0.3 + random.random() * 0.3)
        try:
            items += fetch_page(tc)
        except FetchError:
            pass
    seen, merged = set(), []
    for it in items:
        if it["u"] in seen:
            continue
        seen.add(it["u"])
        merged.append(it)
    return merged[:MAX_IMAGES]


def main() -> None:
    chars = json.loads((BASE / "data" / "chars.json").read_text("utf-8"))
    # 學習字表優先，詩字擴展跟後
    targets = [c for c in chars if c["core"]] + [c for c in chars if c.get("poem")]
    ok = fail = skip = empty = 0
    backoff = 0.0
    for round_no in range(1, 6):
        pending = [c for c in targets if not (OUT / f"{ord(c['kai'])}.json").exists()]
        if not pending:
            break
        print(f"round {round_no}: pending {len(pending)}", flush=True)
        for c in pending:
            kai = c["kai"]
            try:
                items = fetch(kai, c.get("tc", ""))
                (OUT / f"{ord(kai)}.json").write_text(
                    json.dumps(items, ensure_ascii=False), encoding="utf-8"
                )
                ok += 1
                if not items:
                    empty += 1
                backoff = 0.0
                if ok % 100 == 0:
                    print(f"progress: ok {ok} (empty {empty}) fail {fail}", flush=True)
                time.sleep(0.35 + random.random() * 0.3)
            except (FetchError, subprocess.TimeoutExpired) as e:
                fail += 1
                backoff = min(300.0, backoff * 2 if backoff else 10.0)
                if fail % 10 == 1:
                    print(f"fail {kai}: {e} (backoff {backoff:.0f}s)", file=sys.stderr, flush=True)
                time.sleep(backoff + random.random() * 3)
    remaining = sum(1 for c in targets if not (OUT / f"{ord(c['kai'])}.json").exists())
    print(f"done: ok {ok} (empty {empty}) fail {fail} skip {skip} remaining {remaining}")


if __name__ == "__main__":
    main()

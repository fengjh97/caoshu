"""为静态版预抓真迹清单：1000 学习字 → data/calligraphy/<codepoint>.json。

对 shufazidian.com 限速礼貌抓取（4-6s 随机间隔），已有清单跳过（幂等，可断点续跑）。
教训（2026-08-01）：0.8s 间隔连发 100+ 次即触发 s.php 全面 500 临时封禁——务必慢。
连续失败 10 次自动停止，避免在封禁期继续撞墙。
Pages 版前端直接 fetch 这些 JSON，图片 no-referrer 直连图床。
"""

import json
import os
import random
import re
import sys
import time
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent.parent
DATA = Path(
    os.environ.get(
        "CAOSHU_DATA_DIR",
        Path.home() / "Library" / "Application Support" / "Caoshu" / "data",
    )
)
OUT = DATA / "calligraphy"
OUT.mkdir(parents=True, exist_ok=True)

ALLOWED = ("shufazidian.com", "9610.com", "sfzd.cn")
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"


def allowed(url: str) -> bool:
    m = re.match(r"https://([^/]+)/", url + "/")
    if not m:
        return False
    host = m.group(1).lower().split(":")[0]
    return any(host == h or host.endswith("." + h) for h in ALLOWED)


def fetch(kai: str) -> list[str]:
    # sort 碼實測：7=草書 8=行書 9=楷書（歷史版本誤用 8，抓成了行書）
    resp = requests.post(
        "https://www.shufazidian.com/s.php",
        data={"wd": kai, "sort": "7"},
        headers={"User-Agent": UA},
        timeout=20,
    )
    resp.raise_for_status()
    found = re.findall(r"https?://[^\s\"'<>]+?\.(?:jpg|jpeg|png|gif)", resp.text, re.I)
    by_name: dict[str, str] = {}
    for u in found:
        if not (allowed(u) and "/gq/" in u):
            continue
        name = u.rsplit("/", 1)[-1]
        if name not in by_name or len(u) < len(by_name[name]):
            by_name[name] = u
    return list(by_name.values())[:12]


def main() -> None:
    """自適應退避採集：成功保持 ~5s 節奏，失敗指數退避（30s → 10min 封頂）。

    站點限流像個很小的令牌桶（一陣只放兩三個請求），固定間隔會整輪撞牆；
    退避讓節奏自動貼合實際放行速率。隊列輪轉，失敗的字下一圈再試，直到全清。
    """
    chars = json.loads((BASE / "data" / "chars.json").read_text("utf-8"))
    # 學習字表優先，詩字擴展跟後
    targets = [c["kai"] for c in chars if c["core"]] + [
        c["kai"] for c in chars if c.get("poem")
    ]
    ok = fail = 0
    backoff = 0.0
    for round_no in range(1, 41):
        pending = [k for k in targets if not (OUT / f"{ord(k)}.json").exists()]
        if not pending:
            break
        print(f"round {round_no}: pending {len(pending)}", flush=True)
        for kai in pending:
            try:
                urls = fetch(kai)
                (OUT / f"{ord(kai)}.json").write_text(
                    json.dumps(urls, ensure_ascii=False), encoding="utf-8"
                )
                ok += 1
                backoff = 0.0
                if ok % 25 == 0:
                    print(f"progress: ok {ok} fail {fail}", flush=True)
                time.sleep(4 + random.random() * 2)
            except requests.RequestException as e:
                fail += 1
                backoff = min(600.0, backoff * 2 if backoff else 30.0)
                if fail % 25 == 1:
                    print(f"fail {kai}: {e} (backoff {backoff:.0f}s)", file=sys.stderr, flush=True)
                time.sleep(backoff + random.random() * 5)
    remaining = sum(1 for k in targets if not (OUT / f"{ord(k)}.json").exists())
    print(f"done: ok {ok} fail {fail} remaining {remaining}")


if __name__ == "__main__":
    main()

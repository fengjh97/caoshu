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
    resp = requests.post(
        "https://www.shufazidian.com/s.php",
        data={"wd": kai, "sort": "8"},
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
    chars = json.loads((BASE / "data" / "chars.json").read_text("utf-8"))
    core = [c["kai"] for c in chars if c["core"]]
    done = ok = fail = streak_fail = 0
    for kai in core:
        path = OUT / (f"{ord(kai)}.json")
        if path.exists():
            done += 1
            continue
        try:
            urls = fetch(kai)
            path.write_text(json.dumps(urls, ensure_ascii=False), encoding="utf-8")
            ok += 1
            streak_fail = 0
        except requests.RequestException as e:
            fail += 1
            streak_fail += 1
            print(f"fail {kai}: {e}", file=sys.stderr)
            if streak_fail >= 10:
                print("连续失败 10 次，疑似被限流，停止。稍后再跑（幂等续传）。")
                break
        time.sleep(4 + random.random() * 2)
        if (ok + fail) % 50 == 0 and (ok + fail):
            print(f"progress: skip {done} ok {ok} fail {fail}", flush=True)
    print(f"done: skip {done} ok {ok} fail {fail}")


if __name__ == "__main__":
    main()

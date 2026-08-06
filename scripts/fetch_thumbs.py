"""真跡圖本體下載 → 本地縮略圖（自託管，不再依賴對方圖床）。

背景：pic.39017.com 圖床要求「非空 referer + 完整瀏覽器 UA」，桌面瀏覽器熱鏈可以，
但 iOS Safari 實測拿不到圖（疑 referer 被剝/端口 447 被攔），代理（wsrv.nl）也因
無 referer 被餵空。唯一穩妥是把圖抓下來縮成 webp 進倉庫。

每字取前 8 張（優先書法家去重），高 224px webp。manifest 條目加 "f" 字段指向本地文件
（保留 u/by），前端優先用 f。冪等續傳，可反覆跑。
"""

from __future__ import annotations

import io
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

DATA = Path(
    os.environ.get(
        "CAOSHU_DATA_DIR",
        Path.home() / "Library" / "Application Support" / "Caoshu" / "data",
    )
)
MANIFESTS = DATA / "calligraphy"
OUT = DATA / "calligraphy_img"
OUT.mkdir(parents=True, exist_ok=True)

# 圖床要完整瀏覽器 UA + Accept + 非空 Referer（三者缺一喂空 0 字節）
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
HEADERS = [
    "-H", f"User-Agent: {UA}",
    "-H", "Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "-H", "Referer: https://shufa.guoxuedashi.com/",
]
PER_CHAR = 8
THUMB_H = 224


def download(url: str) -> bytes:
    p = subprocess.run(
        ["curl", "-s", "--max-time", "40", *HEADERS, url],
        capture_output=True, timeout=45,
    )
    if p.returncode != 0 or len(p.stdout) < 500:
        raise RuntimeError(f"curl {p.returncode} {len(p.stdout)}B")
    return p.stdout


def to_thumb(raw: bytes, dst: Path) -> None:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.height > THUMB_H:
        img = img.resize((max(1, round(img.width * THUMB_H / img.height)), THUMB_H), Image.LANCZOS)
    img.save(dst, "WEBP", quality=60, method=4)


def pick(items: list[dict]) -> list[dict]:
    """優先每位書法家一張，再按原序補滿。"""
    seen, first, rest = set(), [], []
    for it in items:
        by = it.get("by") or ""
        (rest if by in seen else first).append(it)
        seen.add(by)
    return (first + rest)[:PER_CHAR]


def process_char(mf: Path) -> tuple[int, int, int]:
    """一個字的全部縮略圖（單線程順序處理，manifest 只由本任務寫，無競態）。"""
    items = json.loads(mf.read_text("utf-8"))
    if not items or not isinstance(items[0], dict):
        return 0, 0, 0
    cp = mf.stem
    chosen = pick(items)
    ok = fail = skip = 0
    changed = False
    for i, it in enumerate(chosen):
        fname = f"{cp}_{i}.webp"
        dst = OUT / fname
        if dst.exists():
            if it.get("f") != fname:
                it["f"] = fname
                changed = True
            skip += 1
            continue
        try:
            to_thumb(download(it["u"]), dst)
            it["f"] = fname
            changed = True
            ok += 1
            time.sleep(0.1 + random.random() * 0.2)
        except Exception as e:
            fail += 1
            if random.random() < 0.05:
                print(f"fail {cp}#{i}: {e}", file=sys.stderr, flush=True)
            time.sleep(2 + random.random() * 3)
    if changed:
        # 未下載成功的條目不帶 f，前端回退遠程 URL
        merged = chosen + [it for it in items if it not in chosen]
        mf.write_text(json.dumps(merged[:PER_CHAR + 4], ensure_ascii=False), encoding="utf-8")
    return ok, fail, skip


def main() -> None:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    files = sorted(MANIFESTS.glob("*.json"))
    ok = fail = skip = done_chars = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(process_char, mf) for mf in files]
        for fut in as_completed(futures):
            o, f, s = fut.result()
            ok += o
            fail += f
            skip += s
            done_chars += 1
            if done_chars % 100 == 0:
                print(f"progress: chars {done_chars}/{len(files)} ok {ok} fail {fail} skip {skip}", flush=True)
    total = len(list(OUT.glob("*.webp")))
    size = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"done: ok {ok} fail {fail} skip {skip} · {total} thumbs {size/1e6:.0f}MB")


if __name__ == "__main__":
    main()

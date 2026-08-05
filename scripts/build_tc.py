"""繁體化數據構建。

1. data/chars.json 每字加 `tc`（繁體顯示形；內部 key / 草書字體 codepoint 仍用原簡體字）
2. data/decompositions.json 文案轉繁體（kai 鍵不動，加 tc 字段）
3. 唐詩三百首 → data/poems.json（源 chinese-poetry，本身已是繁體）

注意：重跑 build_chars.py 會丟掉 tc 字段，跑完需再跑本腳本。
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

from opencc import OpenCC

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
TANG300_URL = (
    "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/"
    "%E8%92%99%E5%AD%A6/tangshisanbaishou.json"
)

cc = OpenCC("s2t")


def augment_chars() -> None:
    chars = json.loads((DATA / "chars.json").read_text("utf-8"))
    for c in chars:
        c["tc"] = cc.convert(c["kai"])
    (DATA / "chars.json").write_text(
        json.dumps(chars, ensure_ascii=False), encoding="utf-8"
    )
    diff = sum(1 for c in chars if c["tc"] != c["kai"])
    print(f"chars.json: {len(chars)} 字, 繁簡有別 {diff}")


def convert_decompositions() -> None:
    decs = json.loads((DATA / "decompositions.json").read_text("utf-8"))
    for d in decs:
        d["tc"] = cc.convert(d["kai"])
        d["evolution"] = cc.convert(d.get("evolution", ""))
        for s in d.get("symbols", []):
            for k in ("component", "cursive", "note"):
                if s.get(k):
                    s[k] = cc.convert(s[k])
    (DATA / "decompositions.json").write_text(
        json.dumps(decs, ensure_ascii=False), encoding="utf-8"
    )
    print(f"decompositions.json: {len(decs)} 條已轉繁體")


def build_poems() -> None:
    cache = Path("/tmp/tang300.json")
    if cache.exists():
        raw = json.loads(cache.read_text("utf-8"))
    else:
        with urllib.request.urlopen(TANG300_URL, timeout=60) as r:
            raw = json.load(r)
    # 剝掉校勘注：「(惜取 一作：須取)」之類，且注釋可能跨行 ——
    # 先合併全文去注，再按句末標點重切行。
    strip_note = re.compile(r"[（(][^（）()]*[）)]")
    strip_dangling = re.compile(r"[（(][^（）()]*$")
    poems = []
    for section in raw["content"]:
        for p in section["content"]:
            text = "".join(ln.strip() for ln in p["paragraphs"])
            while strip_note.search(text):
                text = strip_note.sub("", text)
            text = strip_dangling.sub("", text)
            text = re.sub(r"[）)]", "", text)
            lines = [ln for ln in re.findall(r"[^。；？！]*[。；？！]?", text) if ln.strip()]
            if not lines:
                continue
            poems.append(
                {
                    "t": p.get("subchapter") or p["chapter"],
                    "a": p["author"],
                    "ty": section["type"],
                    "ls": lines,
                }
            )
    out = DATA / "poems.json"
    out.write_text(json.dumps(poems, ensure_ascii=False), encoding="utf-8")
    print(f"poems.json: {len(poems)} 首, {out.stat().st_size / 1000:.0f}KB")


if __name__ == "__main__":
    augment_chars()
    convert_decompositions()
    build_poems()

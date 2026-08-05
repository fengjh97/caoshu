"""繁體化與詩詞數據構建。

1. data/chars.json 每字加 `tc`（繁體顯示形；內部 key / 草書字體 codepoint 仍用原簡體字）
2. 唐詩三百首 → data/poems.json（源 chinese-poetry，本身已是繁體，剝校勘注）
3. 字庫擴充：詩中不在基礎 3000 字的字，只要草書字體有字形就補進字庫
   （kai 取字體有字形的碼位——簡體優先，否則用繁體碼位並存 `sc` 簡體別名；
   拼音 pypinyin，freqRank 3001 起按詩中出現頻次排，core=False，poem=True）
4. data/decompositions.json 文案轉繁體（kai 鍵不動，加 tc 字段）
5. 重新子集化草書字體 woff2（全字庫 + UI 草書字「書畢入墨」）

注意：重跑 build_chars.py 會丟掉 tc / poem 擴充，跑完需再跑本腳本。
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


def extend_chars_from_poems() -> None:
    """詩用字補進字庫（字體有字形才收）。冪等：已有的字跳過。"""
    import re as _re
    from collections import Counter

    from fontTools.ttLib import TTFont
    from pypinyin import Style, pinyin

    t2s = OpenCC("t2s")
    cmap = TTFont(BASE / "static" / "fonts" / "LiuJianMaoCao.ttf").getBestCmap()
    chars = json.loads((DATA / "chars.json").read_text("utf-8"))
    known = {c["kai"] for c in chars} | {c["tc"] for c in chars}
    poems = json.loads((DATA / "poems.json").read_text("utf-8"))
    han = _re.compile(r"[一-鿿]")

    counts: Counter = Counter()
    for p in poems:
        for ln in p["ls"]:
            for ch in ln:
                if han.match(ch) and ch not in known:
                    counts[ch] += 1

    added, nofont = [], []
    rank = max(c["freqRank"] for c in chars)
    for tc_ch, _n in counts.most_common():
        s_ch = t2s.convert(tc_ch)
        if ord(s_ch) in cmap:
            kai = s_ch
        elif ord(tc_ch) in cmap:
            kai = tc_ch
        else:
            nofont.append(tc_ch)
            continue
        if kai in {c["kai"] for c in added}:
            continue
        rank += 1
        entry = {
            "kai": kai,
            "pinyin": pinyin(tc_ch, style=Style.TONE, errors="ignore")[0][0]
            if pinyin(tc_ch, style=Style.TONE, errors="ignore") else "",
            "freqRank": rank,
            "core": False,
            "tc": tc_ch,
            "poem": True,
        }
        if s_ch != kai:
            entry["sc"] = s_ch  # 簡體別名（kai 用了繁體碼位時供檢索/映射）
        added.append(entry)
    chars.extend(added)
    (DATA / "chars.json").write_text(
        json.dumps(chars, ensure_ascii=False), encoding="utf-8"
    )
    print(f"字庫擴充: +{len(added)} → {len(chars)} 字; 字體無字形捨棄 {len(nofont)}: {''.join(nofont[:30])}…")


def subset_font() -> None:
    """詩字擴展子集 woff2 + unicode-range @font-face。

    基礎 3000 字沿用原 LiuJianMaoCao-sub.woff2（Google Fonts 優化輪廓，956KB，勿重生成——
    本地 fontTools 管線產物比它大一倍）。擴充字單獨成包，unicode-range 讓瀏覽器
    只在真的遇到生僻詩字時才拉取。
    """
    from fontTools import subset

    chars = json.loads((DATA / "chars.json").read_text("utf-8"))
    ext = sorted({c["kai"] for c in chars if c.get("poem")})
    options = subset.Options(flavor="woff2")
    options.hinting = False
    options.layout_features = []
    options.name_IDs = [1, 2]
    options.notdef_outline = False
    font = subset.load_font(str(BASE / "static" / "fonts" / "LiuJianMaoCao.ttf"), options)
    ss = subset.Subsetter(options)
    ss.populate(text="".join(ext))
    ss.subset(font)
    out = BASE / "static" / "fonts" / "LiuJianMaoCao-ext.woff2"
    font.save(str(out))

    # unicode-range：連續碼位合併
    cps = sorted(ord(c) for c in ext)
    ranges, lo, hi = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == hi + 1:
            hi = cp
        else:
            ranges.append((lo, hi))
            lo = hi = cp
    ranges.append((lo, hi))
    ur = ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)
    css = (
        "/* build_tc.py 生成：詩字擴展草書字形，unicode-range 按需加載 */\n"
        "@font-face {\n"
        '  font-family: "LiuJianMaoCao";\n'
        '  src: url("fonts/LiuJianMaoCao-ext.woff2") format("woff2");\n'
        "  font-display: swap;\n"
        f"  unicode-range: {ur};\n"
        "}\n"
    )
    (BASE / "static" / "font-ext.css").write_text(css, encoding="utf-8")
    print(f"擴展字體: {len(ext)} 字 → {out.stat().st_size / 1000:.0f}KB, unicode-range {len(ranges)} 段")


if __name__ == "__main__":
    augment_chars()
    build_poems()
    extend_chars_from_poems()
    convert_decompositions()
    subset_font()

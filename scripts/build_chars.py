"""字库构建：hanziDB.csv → data/chars.json。

- 字库 3000：按语料字频序，只收《通用规范汉字表》收录字（过滤生僻/异体）。
- 学习集 1000（core=True）：字频前 1000 且属于一级字表（3500 常用字）。
- 拼音：优先沿用旧版人工核对过的 500 字拼音，其余用 hanziDB 的带调拼音。

用法：.venv/bin/python scripts/build_chars.py /tmp/hanziDB.csv
"""

import csv
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
LIB_SIZE = 3000
CORE_SIZE = 1000


def main(csv_path: str) -> None:
    legacy = {}
    legacy_file = BASE / "data" / "hanzi_freq.json"
    if legacy_file.exists():
        legacy = {h["kai"]: h["pinyin"] for h in json.loads(legacy_file.read_text("utf-8"))}

    rows = []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            kai = row["charcter"].strip()  # 源数据列名就是这个拼写
            std = row["general_standard_num"].strip()
            if len(kai) != 1 or not std or std == "0":
                continue
            rows.append(
                {
                    "kai": kai,
                    "pinyin": legacy.get(kai) or row["pinyin"].strip(),
                    "freq": int(row["frequency_rank"]),
                    "std": int(std),
                }
            )

    rows.sort(key=lambda r: r["freq"])
    seen: set[str] = set()
    lib = []
    for r in rows:
        if r["kai"] in seen:
            continue
        seen.add(r["kai"])
        lib.append(r)
        if len(lib) >= LIB_SIZE:
            break

    # 学习集：字频序里前 1000 个属于一级字表（std<=3500）的字。
    core = set()
    for r in lib:
        if len(core) >= CORE_SIZE:
            break
        if r["std"] <= 3500:
            core.add(r["kai"])

    out = [
        {"kai": r["kai"], "pinyin": r["pinyin"], "freqRank": i + 1, "core": r["kai"] in core}
        for i, r in enumerate(lib)
    ]
    (BASE / "data" / "chars.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"chars.json: {len(out)} 字，core {sum(1 for o in out if o['core'])}")
    decomp = {d["kai"] for d in json.loads((BASE / "data" / "decompositions.json").read_text("utf-8"))}
    covered = sum(1 for o in out if o["core"] and o["kai"] in decomp)
    print(f"core 中有拆解内容的: {covered}/{CORE_SIZE}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/hanziDB.csv")

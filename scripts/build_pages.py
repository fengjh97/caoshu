"""组装 GitHub Pages 静态版 → docs/。

docs/ = static/ 全量 + data JSON + 真迹清单 + config.js 覆写为静态模式。
跑完提交推送，Pages 从 master:/docs 发布。
"""

import json
import os
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "docs"
# 真迹清单缓存在用户数据目录（Documents 外），与 app.py / prefetch 一致。
DATA = Path(
    os.environ.get(
        "CAOSHU_DATA_DIR",
        Path.home() / "Library" / "Application Support" / "Caoshu" / "data",
    )
)


def main() -> None:
    if DOCS.exists():
        shutil.rmtree(DOCS)
    shutil.copytree(BASE / "static", DOCS)

    # 静态模式开关。
    (DOCS / "js" / "config.js").write_text(
        "/* GitHub Pages 静态版（由 build_pages.py 生成） */\n"
        "window.CAOSHU_STATIC = true;\n",
        encoding="utf-8",
    )

    # 数据：字库 + 拆解 + 真迹清单。
    data = DOCS / "data"
    data.mkdir()
    shutil.copy(BASE / "data" / "chars.json", data / "chars.json")
    shutil.copy(BASE / "data" / "decompositions.json", data / "decompositions.json")

    calli_src = DATA / "calligraphy"
    calli_dst = data / "calligraphy"
    calli_dst.mkdir()
    n = 0
    for f in sorted(calli_src.glob("*.json")) if calli_src.exists() else []:
        # 只带清单 JSON（图片本体不进仓库，前端 no-referrer 直连图床）。
        urls = json.loads(f.read_text("utf-8"))
        if urls:
            shutil.copy(f, calli_dst / f.name)
            n += 1

    # 全字重 TTF 不进 Pages（4.7MB），子集 woff2 已够 3000 字。
    ttf = DOCS / "fonts" / "LiuJianMaoCao.ttf"
    if ttf.exists():
        ttf.unlink()

    (DOCS / ".nojekyll").write_text("")
    total = sum(f.stat().st_size for f in DOCS.rglob("*") if f.is_file())
    print(f"docs/ built: 真迹清单 {n} 字, 总体积 {total/1e6:.1f}MB")


if __name__ == "__main__":
    main()

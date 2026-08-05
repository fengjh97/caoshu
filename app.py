"""草书 Web —— Flask 后端。

单文件后端：SQLite 存卡片/日志，py-fsrs 调度，代理 Gemini 手写判定与
书法字典真迹抓取。前端为 static/ 下纯静态单页。
"""

import base64
import hashlib
import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from fsrs import Card as FSRSCard
from fsrs import Rating as FSRSRating
from fsrs import Scheduler

BASE = Path(__file__).resolve().parent
CONTENT = BASE / "data"  # 随代码走的内容文件：chars.json / decompositions.json
# 用户数据（SQLite/config/真迹缓存）放 Documents 保护区外，launchd 才能读写。
DATA = Path(
    os.environ.get(
        "CAOSHU_DATA_DIR",
        Path.home() / "Library" / "Application Support" / "Caoshu" / "data",
    )
)
DB_PATH = DATA / "caoshu.db"
CONFIG_PATH = DATA / "config.json"
CALLIG_DIR = DATA / "calligraphy"

GEMINI_MODEL = "gemini-3.1-pro-preview"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
SHUFA_BASE = "https://www.shufazidian.com"
# 真迹图片来源白名单（与 iOS 版一致）：只信书法字典站已知图床。
ALLOWED_IMG_HOSTS = ("shufazidian.com", "9610.com", "sfzd.cn")
MAX_CALLIG_IMAGES = 12

app = Flask(__name__, static_folder="static", static_url_path="")
scheduler = Scheduler()
_db_lock = threading.Lock()

# ---------------------------------------------------------------- 内容（静态 JSON）

with open(CONTENT / "chars.json", encoding="utf-8") as f:
    FREQ_TABLE = json.load(f)  # [{kai, pinyin, freqRank, core}] 3000 字库
with open(CONTENT / "decompositions.json", encoding="utf-8") as f:
    DECOMPOSITIONS = {d["kai"]: d for d in json.load(f)}
HANZI_BY_KAI = {h["kai"]: h for h in FREQ_TABLE}
CORE_TABLE = [h for h in FREQ_TABLE if h.get("core")]  # 1000 学习字
CORE_KAI = {h["kai"] for h in CORE_TABLE}

# ---------------------------------------------------------------- 配置

DEFAULT_CONFIG = {"daily_new_limit": 10, "gemini_api_key": ""}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- DB


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    CALLIG_DIR.mkdir(exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS cards(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kai TEXT NOT NULL,
                direction TEXT NOT NULL CHECK(direction IN ('recognize','produce')),
                fsrs TEXT,
                due TEXT,
                last_review TEXT,
                first_review TEXT,
                reps INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                state INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS review_log(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                reviewed_at TEXT NOT NULL,
                elapsed_days REAL NOT NULL,
                scheduled_days REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
            CREATE INDEX IF NOT EXISTS idx_log_time ON review_log(reviewed_at);
            """
        )
        # 学习集 seed：每字两张卡（认字 + 书写）。增量幂等——
        # 字表扩容时补插新字，已有卡与进度原样保留。
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_kd ON cards(kai, direction)"
        )
        rows = []
        for h in CORE_TABLE:
            rows.append((h["kai"], "recognize"))
            rows.append((h["kai"], "produce"))
        conn.executemany("INSERT OR IGNORE INTO cards(kai, direction) VALUES(?,?)", rows)


# ---------------------------------------------------------------- FSRS 辅助


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def local_date(iso: str) -> str:
    """UTC ISO 串 → 本地日期字符串（天级统计用本地时区）。"""
    return datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d")


def card_json(row, pinyin=True) -> dict:
    h = HANZI_BY_KAI.get(row["kai"], {})
    return {
        "id": row["id"],
        "kai": row["kai"],
        "pinyin": h.get("pinyin", ""),
        "freqRank": h.get("freqRank", 0),
        "direction": row["direction"],
        "reps": row["reps"],
        "state": row["state"],
        "due": row["due"],
        "isNew": row["reps"] == 0,
    }


def build_queue(conn, cfg) -> dict:
    now = now_utc()
    today = now.astimezone().strftime("%Y-%m-%d")
    day_start_utc = (
        now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc).isoformat()
    )

    reviews = conn.execute(
        "SELECT * FROM cards WHERE reps > 0 AND due <= ? ORDER BY due ASC",
        (now.isoformat(),),
    ).fetchall()

    introduced_today = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE first_review IS NOT NULL AND first_review >= ?",
        (day_start_utc,),
    ).fetchone()[0]
    allowance = max(0, int(cfg["daily_new_limit"]) - introduced_today)

    new_cards = []
    if allowance:
        # 新卡只出学习字表（core），按当前字库的字频序。
        candidates = conn.execute("SELECT * FROM cards WHERE reps = 0").fetchall()
        candidates = [r for r in candidates if r["kai"] in CORE_KAI]
        candidates.sort(key=lambda r: (HANZI_BY_KAI[r["kai"]]["freqRank"], r["direction"]))
        new_cards = candidates[:allowance]

    done_today = conn.execute(
        "SELECT COUNT(*) FROM review_log WHERE reviewed_at >= ?", (day_start_utc,)
    ).fetchone()[0]

    queue = [card_json(r) for r in reviews] + [card_json(r) for r in new_cards]
    return {
        "date": today,
        "queue": queue,
        "newCount": len(new_cards),
        "reviewCount": len(reviews),
        "doneToday": done_today,
        "streak": compute_streak(conn),
    }


def compute_streak(conn) -> int:
    rows = conn.execute("SELECT reviewed_at FROM review_log").fetchall()
    if not rows:
        return 0
    days = {local_date(r["reviewed_at"]) for r in rows}
    cursor = datetime.now().astimezone()
    if cursor.strftime("%Y-%m-%d") not in days:
        cursor -= timedelta(days=1)  # 今天还没学，从昨天起算
    streak = 0
    while cursor.strftime("%Y-%m-%d") in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


# ---------------------------------------------------------------- 页面与 PWA


@app.get("/")
def index():
    return send_from_directory(BASE / "static", "index.html")


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(BASE / "static", "manifest.webmanifest")


@app.route("/data/<path:name>")
def data_file(name):
    """內容 JSON（chars/decompositions/poems）—— 與靜態版同路徑，前端零分支。"""
    return send_from_directory(CONTENT, name)


# ---------------------------------------------------------------- API：状态 / 队列


@app.get("/api/state")
def api_state():
    cfg = load_config()
    with _db_lock, db() as conn:
        payload = build_queue(conn, cfg)
    payload["geminiConfigured"] = bool(cfg.get("gemini_api_key"))
    payload["dailyNewLimit"] = int(cfg["daily_new_limit"])
    return jsonify(payload)


@app.post("/api/grade")
def api_grade():
    body = request.get_json(force=True)
    card_id = int(body["card_id"])
    rating = int(body["rating"])
    if rating not in (1, 2, 3, 4):
        return jsonify({"error": "rating must be 1-4"}), 400

    now = now_utc()
    with _db_lock, db() as conn:
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if row is None:
            return jsonify({"error": "card not found"}), 404

        fcard = FSRSCard.from_dict(json.loads(row["fsrs"])) if row["fsrs"] else FSRSCard()
        prev_last = fcard.last_review
        elapsed = max(0.0, (now - prev_last).total_seconds() / 86400) if prev_last else 0.0

        fcard, _ = scheduler.review_card(fcard, FSRSRating(rating), now)
        scheduled = max(0.0, (fcard.due - now).total_seconds() / 86400)

        conn.execute(
            """UPDATE cards SET fsrs=?, due=?, last_review=?, reps=reps+1,
               lapses=lapses+?, state=?, first_review=COALESCE(first_review, ?)
               WHERE id=?""",
            (
                json.dumps(fcard.to_dict()),
                fcard.due.isoformat(),
                now.isoformat(),
                1 if (rating == 1 and row["reps"] > 0) else 0,
                int(fcard.state),
                now.isoformat(),
                card_id,
            ),
        )
        conn.execute(
            "INSERT INTO review_log(card_id, rating, reviewed_at, elapsed_days, scheduled_days)"
            " VALUES(?,?,?,?,?)",
            (card_id, rating, now.isoformat(), elapsed, scheduled),
        )
        payload = build_queue(conn, load_config())
    return jsonify(payload)


# ---------------------------------------------------------------- API：内容


@app.get("/api/chars")
def api_chars():
    with _db_lock, db() as conn:
        rows = conn.execute(
            "SELECT kai, MAX(reps) AS max_reps FROM cards GROUP BY kai"
        ).fetchall()
    started = {r["kai"] for r in rows if r["max_reps"] > 0}
    out = [
        {**h, "started": h["kai"] in started, "hasDecomp": h["kai"] in DECOMPOSITIONS}
        for h in FREQ_TABLE
    ]
    return jsonify(out)


@app.get("/api/decomposition/<kai>")
def api_decomposition(kai):
    h = HANZI_BY_KAI.get(kai)
    if h is None:
        return jsonify({"error": "not found"}), 404
    d = DECOMPOSITIONS.get(kai)
    if d is None:
        # 字库内但暂无拆解详解：给基础信息，前端显示占位并保留真迹。
        return jsonify(
            {"kai": kai, "pinyin": h.get("pinyin", ""), "symbols": [],
             "evolution": "", "confusable": [], "missing": True}
        )
    return jsonify({**d, "pinyin": h.get("pinyin", "")})


@app.get("/api/options/<kai>")
def api_options(kai):
    """认字 4 选 1 选项（含正确答案，已打乱）。干扰项取学习字表。"""
    import random

    pool = [k for k in CORE_KAI if k != kai]
    options = random.sample(pool, 3) + [kai]
    random.shuffle(options)
    return jsonify(options)


# ---------------------------------------------------------------- API：进度


@app.get("/api/progress")
def api_progress():
    with _db_lock, db() as conn:
        cards = conn.execute("SELECT * FROM cards").fetchall()
        (total_reviews,) = conn.execute("SELECT COUNT(*) FROM review_log").fetchone()
        streak = compute_streak(conn)

    mastered = learning = not_started = 0
    dist: dict[str, int] = {}
    for c in cards:
        if c["reps"] == 0:
            not_started += 1
        elif c["state"] == 2 and (json.loads(c["fsrs"]).get("stability") or 0) >= 21:
            mastered += 1
        else:
            learning += 1
        if c["reps"] > 0 and c["due"]:
            day = local_date(c["due"])
            dist[day] = dist.get(day, 0) + 1

    return jsonify(
        {
            "mastered": mastered,
            "learning": learning,
            "notStarted": not_started,
            "totalReviews": total_reviews,
            "streak": streak,
            "dueDistribution": [{"date": k, "count": v} for k, v in sorted(dist.items())],
        }
    )


# ---------------------------------------------------------------- API：设置


@app.get("/api/settings")
def api_settings_get():
    cfg = load_config()
    return jsonify(
        {"dailyNewLimit": int(cfg["daily_new_limit"]), "geminiConfigured": bool(cfg["gemini_api_key"])}
    )


@app.post("/api/settings")
def api_settings_post():
    body = request.get_json(force=True)
    cfg = load_config()
    if "dailyNewLimit" in body:
        cfg["daily_new_limit"] = max(0, min(100, int(body["dailyNewLimit"])))
    if "geminiKey" in body:
        cfg["gemini_api_key"] = str(body["geminiKey"]).strip()
    save_config(cfg)
    return jsonify(
        {"dailyNewLimit": int(cfg["daily_new_limit"]), "geminiConfigured": bool(cfg["gemini_api_key"])}
    )


# ---------------------------------------------------------------- API：Gemini 手写判定

JUDGE_PROMPT = """你是草书书写评判老师。下图是用户用手指在手机上手写的笔迹，目标是写出「{kai}」字的标准草书形。
判定标准：只看字形结构是否像目标字的标准草书写法（笔画连写、符号构成、整体轮廓），容错较高，不计较笔锋粗细与抖动。
请只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块，格式：
{{"score": <0-100整数>, "verdict": "pass"或"fail", "feedback": "<一句中文反馈，指出像/不像在哪>"}}
score>=70 视为 pass。"""


def self_assess(kai: str) -> dict:
    return {
        "score": 0,
        "verdict": "fail",
        "feedback": f"当前离线或未配置 API Key，无法自动判定「{kai}」。请对照范本自行评分。",
        "mode": "selfAssess",
        "suggestedRating": 3,
    }


def suggested_rating(score: int) -> int:
    if score < 50:
        return 1
    if score < 70:
        return 2
    if score < 90:
        return 3
    return 4


@app.post("/api/judge")
def api_judge():
    body = request.get_json(force=True)
    kai = body.get("kai", "")
    image = body.get("image", "")
    cfg = load_config()
    key = cfg.get("gemini_api_key", "")
    if not key or not image or kai not in HANZI_BY_KAI:
        return jsonify(self_assess(kai))

    # data URL → 纯 base64。
    if "," in image:
        image = image.split(",", 1)[1]

    try:
        resp = requests.post(
            f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                "contents": [
                    {
                        "parts": [
                            {"text": JUDGE_PROMPT.format(kai=kai)},
                            {"inline_data": {"mime_type": "image/png", "data": image}},
                        ]
                    }
                ]
            },
            timeout=30,
        )
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (requests.RequestException, KeyError, IndexError, ValueError):
        return jsonify(self_assess(kai))

    # 宽松解析：抓第一个 { 到最后一个 }，容忍模型包裹代码块。
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return jsonify(self_assess(kai))
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return jsonify(self_assess(kai))

    score = max(0, min(100, int(obj.get("score", 0))))
    verdict = obj.get("verdict")
    if verdict not in ("pass", "fail"):
        verdict = "pass" if score >= 70 else "fail"
    return jsonify(
        {
            "score": score,
            "verdict": verdict,
            "feedback": str(obj.get("feedback", "（无反馈）")),
            "mode": "gemini",
            "suggestedRating": suggested_rating(score),
        }
    )


# ---------------------------------------------------------------- API：真迹（书法字典代理 + 缓存）


def _allowed_img(url: str) -> bool:
    m = re.match(r"https://([^/]+)/", url + "/")
    if not m:
        return False
    host = m.group(1).lower().split(":")[0]
    return any(host == h or host.endswith("." + h) for h in ALLOWED_IMG_HOSTS)


def _manifest_path(kai: str) -> Path:
    safe = "_".join(str(ord(ch)) for ch in kai)
    return CALLIG_DIR / f"{safe}.json"


@app.get("/api/calligraphy/<kai>")
def api_calligraphy(kai):
    mp = _manifest_path(kai)
    urls: list[str] = []
    if mp.exists():
        try:
            urls = json.loads(mp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            urls = []
    if not urls:
        try:
            # 站点真实接口：POST s.php，sort=8 = 只搜草书。
            resp = requests.post(
                f"{SHUFA_BASE}/s.php",
                data={"wd": kai, "sort": "7"},  # 7=草書（8 是行書，歷史誤用）
                headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"},
                timeout=20,
            )
            resp.raise_for_status()
            found = re.findall(r"https?://[^\s\"'<>]+?\.(?:jpg|jpeg|png|gif)", resp.text, re.I)
            # 只要作品图（/gq/ 路径）；同名图去重，优先保留原图（无 /1/ 缩略段）。
            by_name: dict[str, str] = {}
            for u in found:
                if not (_allowed_img(u) and "/gq/" in u):
                    continue
                name = u.rsplit("/", 1)[-1]
                if name not in by_name or len(u) < len(by_name[name]):
                    by_name[name] = u
            urls = list(by_name.values())[:MAX_CALLIG_IMAGES]
            if urls:
                mp.write_text(json.dumps(urls, ensure_ascii=False), encoding="utf-8")
        except requests.RequestException:
            urls = []
    # 返回经本端代理的地址，规避图床防盗链。
    proxied = [
        "/api/img?u=" + base64.urlsafe_b64encode(u.encode()).decode() for u in urls
    ]
    return jsonify(proxied)


@app.get("/api/img")
def api_img():
    try:
        url = base64.urlsafe_b64decode(request.args.get("u", "")).decode()
    except (ValueError, UnicodeDecodeError):
        return "bad url", 400
    if not _allowed_img(url):
        return "forbidden host", 403

    ext = url.rsplit(".", 1)[-1].lower()
    cache = CALLIG_DIR / f"img_{hashlib.sha1(url.encode()).hexdigest()}.{ext}"
    if not cache.exists():
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Referer": SHUFA_BASE + "/"},
                timeout=20,
            )
            resp.raise_for_status()
            cache.write_bytes(resp.content)
        except requests.RequestException:
            return "fetch failed", 502
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif"}
    return cache.read_bytes(), 200, {"Content-Type": mime.get(ext, "image/jpeg"),
                                     "Cache-Control": "public, max-age=604800"}


# ---------------------------------------------------------------- 启动

init_db()

if __name__ == "__main__":
    import os

    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8873")))

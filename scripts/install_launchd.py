"""安装/更新 caoshu 常驻服务（LaunchAgent）。

macOS TCC 保护 ~/Documents，launchd 无权限进入（spawn 直接 EX_CONFIG=78 失败），
所以把可运行副本镜像到 ~/Library/Application Support/Caoshu/runtime 并从那里跑。
用户数据（SQLite / config / 真迹缓存）统一放同目录 data/，手动跑和常驻跑同一份。

用法（改完代码后重跑即更新镜像并重启服务）：

    python3 scripts/install_launchd.py
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUPPORT = Path.home() / "Library" / "Application Support" / "Caoshu"
RUNTIME = SUPPORT / "runtime"
DATA = SUPPORT / "data"
LOGS = SUPPORT / "logs"
VENV = RUNTIME / ".venv"
LABEL = "com.nianian.caoshu"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
PORT = "8873"

# 镜像内容：代码 + 静态前端 + 内容 JSON。用户数据不进 runtime。
MIRROR = [
    "app.py",
    "requirements.txt",
    "static",
    "data/chars.json",
    "data/decompositions.json",
]


def run(*cmd: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def stop_agent() -> None:
    run("launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}", check=False)
    time.sleep(1)


def mirror_runtime() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for rel in MIRROR:
        src, dst = REPO / rel, RUNTIME / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)


def ensure_venv() -> None:
    if not (VENV / "bin" / "python").exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    subprocess.run(
        [str(VENV / "bin" / "pip"), "install", "-q", "-r", str(RUNTIME / "requirements.txt")],
        check=True,
    )


def migrate_data() -> None:
    """首次安装：把 Documents 里的旧用户数据复制到规范位置（不删原件）。"""
    DATA.mkdir(parents=True, exist_ok=True)
    old = REPO / "data"
    if (DATA / "caoshu.db").exists() or not (old / "caoshu.db").exists():
        return
    print("迁移用户数据 → ", DATA)
    shutil.copy2(old / "caoshu.db", DATA / "caoshu.db")
    if (old / "config.json").exists():
        shutil.copy2(old / "config.json", DATA / "config.json")
    if (old / "calligraphy").is_dir():
        shutil.copytree(old / "calligraphy", DATA / "calligraphy", dirs_exist_ok=True)


def write_plist() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    plist = {
        "Label": LABEL,
        "ProgramArguments": [str(VENV / "bin" / "python"), str(RUNTIME / "app.py")],
        "WorkingDirectory": str(RUNTIME),
        "EnvironmentVariables": {"PORT": PORT, "CAOSHU_DATA_DIR": str(DATA)},
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(LOGS / "server.log"),
        "StandardErrorPath": str(LOGS / "server.log"),
    }
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    with open(PLIST, "wb") as f:
        plistlib.dump(plist, f)


def start_agent() -> None:
    run("launchctl", "bootstrap", f"gui/{os.getuid()}", str(PLIST))
    for _ in range(15):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/chars", timeout=2) as r:
                if r.status == 200:
                    print(f"服务已常驻: http://127.0.0.1:{PORT}/")
                    return
        except OSError:
            continue
    print("警告：服务 15 秒内未响应，查看日志：", LOGS / "server.log")
    sys.exit(1)


def main() -> None:
    stop_agent()
    mirror_runtime()
    ensure_venv()
    migrate_data()
    write_plist()
    start_agent()


if __name__ == "__main__":
    main()

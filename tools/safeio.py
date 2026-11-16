# -*- coding: utf-8 -*-
"""(v140, G10) 정전 대비 파일 쓰기 — 모든 저장 도우미가 이 한 곳을 지난다.

쓰기 순서: 같은 폴더의 임시 파일에 쓴다 → flush → fsync → os.replace(한 번에 바꾸기).
쓰다 끊기면 옛 파일이 그대로 남고, 남은 *.tmp 는 다음 쓰기 때 덮이거나 무시된다(시작 점검·백업은 *.tmp 를 보지 않는다).

READONLY: 시작 점검(tools/integrity.py)에서 깨진 파일이 나오면 사유 문자열을 넣는다. 그 뒤로는 저장이 ReadOnly 예외로 멈춘다
(자동으로 덮어쓰지 않는다 — 사람이 백업에서 되살린 뒤 서버를 다시 켠다).
"""
import json
import os
import threading
import time

READONLY = None          # None = 쓰기 가능, 문자열 = 멈춘 사유
_seq = [0]
_lk = threading.Lock()


class ReadOnly(OSError):
    pass


ALLOW = ("sessions.json",)   # 멈춘 동안에도 쓰는 파일(백업·점검 대상이 아님)


def check_write(path=None):
    if READONLY and not (path and os.path.basename(path) in ALLOW):
        raise ReadOnly("데이터 점검에서 손상된 파일이 발견되어 저장을 멈췄습니다: " + str(READONLY))


def _tmp_name(path):
    with _lk:
        _seq[0] += 1
        n = _seq[0]
    return "%s.%d.%d.tmp" % (path, os.getpid(), n)


def _db(path):
    """(v151) SQLite 엔진이면 데이터 폴더 안 .json·.jsonl 은 vfs(DB)로 간다."""
    import sys
    v = sys.modules.get("vfs")
    return v if (v is not None and v.claimed(path)) else None


def atomic_bytes(path, data, mkdir=True):
    v = _db(path)
    if v:
        return v.write_bytes(path, data, mkdir)
    check_write(path)
    d = os.path.dirname(path)
    if mkdir and d:
        os.makedirs(d, exist_ok=True)
    tmp = _tmp_name(path)
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        for i in range(6):                     # Windows: 다른 스레드가 읽는 중이면 잠깐 기다렸다 다시
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if i == 5:
                    raise
                time.sleep(0.05 * (i + 1))
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def atomic_text(path, text, mkdir=True):
    v = _db(path)
    if v:
        return v.write_text(path, text, mkdir)
    atomic_bytes(path, text.encode("utf-8"), mkdir)


def atomic_json(path, obj, indent=None, mkdir=True):
    atomic_bytes(path, json.dumps(obj, ensure_ascii=False, indent=indent).encode("utf-8"), mkdir)


def append_line(path, line):
    """추가만 하는 줄 로그(jsonl). 한 줄을 통째로 쓰고 fsync — 끊기면 마지막 한 줄만 반쯤 남을 수 있다(점검은 그것을 경고로만 본다)."""
    v = _db(path)
    if v:
        return v.append_line(path, line)
    check_write()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line if line.endswith("\n") else line + "\n")
        fh.flush()
        os.fsync(fh.fileno())

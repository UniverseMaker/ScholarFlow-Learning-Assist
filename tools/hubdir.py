# -*- coding: utf-8 -*-
"""시스템끼리 토큰 전달 파일을 두는 공용 폴더(선택 기능 — 연구행정·AI 관리 등 다른 시스템과 연동할 때만).

찾는 순서: 환경변수 STUDY_HUB_DIR → %USERPROFILE%(~)/.research-hub
"""
import os

DEFAULT = os.path.join(os.path.expanduser("~"), ".research-hub")


def path():
    return os.environ.get("STUDY_HUB_DIR") or DEFAULT


def file(name):
    return os.path.join(path(), name)


def shown(name=""):
    """화면·오류 문구용 — 실제로 쓰는 위치를 그대로 보여 준다."""
    return os.path.join(path(), name) if name else path()

# -*- coding: utf-8 -*-
"""오피스·한글 문서 → PDF (v98) — 이 PC 의 MS Office(Word·PowerPoint·Excel)·한컴오피스 한글을 COM 으로 몰래 띄워 쪽 모양 그대로 만든다.

serve.py(docview.py)가 따로 프로세스로 부른다 — 오피스가 멈춰도 서버는 멈추지 않게(시간 초과면 이 프로세스를 끝낸다).
  python office2pdf.py <원본> <결과.pdf>
암호 걸린 문서는 묻지 않고 실패한다(가짜 암호를 넣어 대화상자를 막는다). 원본은 읽기 전용으로만 연다.
"""
import os
import sys

WORD = {"doc", "docx", "docm", "rtf", "odt", "dot", "dotx"}
PPT = {"ppt", "pptx", "pptm", "pps", "ppsx", "odp", "pot", "potx"}
XLS = {"xls", "xlsx", "xlsm", "xlsb", "ods"}
HWP = {"hwp", "hwpx"}
BUSY = 3     # 사용자가 한글을 쓰는 중 — 한글은 PC 에 하나만 떠서, 끄면 사용자 창까지 닫힌다 → 나중에 다시

def hwp_running():
    import subprocess
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Hwp.exe", "/FO", "CSV", "/NH"], capture_output=True, timeout=15,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.decode("cp949", "replace")
        return "hwp.exe" in out.lower()
    except Exception:      # noqa: BLE001
        return True        # 모르면 건드리지 않는다


def convert(src, dst):
    import pythoncom
    import win32com.client
    ext = src.rsplit(".", 1)[-1].lower()
    pythoncom.CoInitialize()
    tmp = dst + ".part.pdf"
    try:
        if ext in WORD:
            app = win32com.client.DispatchEx("Word.Application")
            app.Visible = False
            app.DisplayAlerts = 0
            try:
                d = app.Documents.Open(src, False, True, False, "__no_password__", "", False, "", "", 0, None, False)
                d.ExportAsFixedFormat(tmp, 17)          # wdExportFormatPDF
                d.Close(False)
            finally:
                app.Quit(False)
        elif ext in PPT:
            app = win32com.client.DispatchEx("PowerPoint.Application")
            try:
                p = app.Presentations.Open(src + "::__no_password__::", True, False, False)   # ReadOnly, Untitled, WithWindow
                p.SaveAs(tmp, 32)                       # ppSaveAsPDF
                p.Close()
            finally:
                app.Quit()
        elif ext in XLS:
            app = win32com.client.DispatchEx("Excel.Application")
            app.Visible = False
            app.DisplayAlerts = False
            try:
                wb = app.Workbooks.Open(src, 0, True, None, "__no_password__")
                wb.ExportAsFixedFormat(0, tmp)          # xlTypePDF
                wb.Close(False)
            finally:
                app.Quit()
        elif ext in HWP:
            if hwp_running():
                print("busy: 한글이 이미 열려 있어요", file=sys.stderr); raise SystemExit(BUSY)
            app = win32com.client.DispatchEx("HWPFrame.HwpObject")
            try:
                try: app.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")     # 보안 승인 창 없이(이 PC 에 모듈 등록됨)
                except Exception: pass   # noqa: E701
                try: app.XHwpWindows.Item(0).Visible = False
                except Exception: pass   # noqa: E701
                try: app.SetMessageBoxMode(0x2FFF1)        # 모든 알림 창은 기본 단추로 — 멈추지 않게
                except Exception: pass   # noqa: E701
                if not app.Open(src, "HWPX" if ext == "hwpx" else "HWP", "forceopen:true;versionwarning:false;suspendpassword:true"):
                    raise RuntimeError("한글이 이 문서를 열지 못했어요(암호·손상 문서일 수 있어요)")
                if not app.SaveAs(tmp, "PDF", ""):
                    raise RuntimeError("한글이 쪽 모양을 만들지 못했어요")
                try: app.Clear(1)
                except Exception: pass   # noqa: E701
            finally:
                app.Quit()
        else:
            raise SystemExit("지원하지 않는 형식: " + ext)
        os.replace(tmp, dst)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("사용법: office2pdf.py <원본> <결과.pdf>")
    convert(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))

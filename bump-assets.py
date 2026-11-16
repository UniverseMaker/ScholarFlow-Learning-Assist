# -*- coding: utf-8 -*-
"""정적 자산 캐시 무효화 + 빌드 번호.

빌드를 올릴 때마다 실행:  python bump-assets.py 372

(v177) 파일마다 ?v=<내용 해시 10자> — 바뀐 파일만 브라우저가 다시 받는다.
  예전엔 배포마다 58개 파일 전부에 같은 빌드 번호를 붙여, 배포 직후 첫 접속이 1.2MB(압축) 전체를 다시 받았다
  (Cloudflare 가 한국 접속을 로스앤젤레스로 돌려 그 길이 느리다 — 200KB 한 파일에 3~11초).
빌드 번호(v177.372 꼴)는 index.html 의 <meta name="app-version"> 하나에 둔다.
  공용 새 버전 알림(RUI.updates)·/version.json(tools/sitever.py)·버전 뱃지가 이 값을 읽는다.
"""
import hashlib, io, os, re, sys

# 스크립트 위치 기준 — 폴더를 옮겨도 동작한다
HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'app-html', 'index.html')
ASSETS = ['style.css', 'ui/rui-tokens.css', 'ui/rui.css', 'ui/rui-gen.css', 'ui/rui-map.css', 'ui/rui-theme.js', 'ui/rui-app.js', 'config.js', 'api.js', 'emergency.js', 'server.js', 'account.js', 'app.js', 'library.js', 'maker.js', 'shell.js', 'reader.js', 'rnd.js', 'docview.js', 'rndread.js', 'toolkit.js', 'rndlink.js', 'toolsets.js', 'toolsets2.js', 'toolsets3.js', 'hubs.js', 'papertpl.js', 'paperkit.js', 'paper.js', 'projinfo.js', 'reporttpl.js', 'report.js', 'litlab.js', 'mockreview.js', 'slidekit.js', 'slidestudio.js', 'deepmeet.js', 'libstudio.js', 'ui/listview.js', 'dashboard.js', 'aitasks.js', 'hublink.js', 'modepages.js']

num = sys.argv[1] if len(sys.argv) > 1 else '40'
# 공용 새 버전 알림이 이 값을 그대로 보여 준다: "새 버전 v131.281 가 나왔습니다"
app = re.search(r'APP_VERSION = "(v\d+)"', io.open(os.path.join(HERE, 'serve.py'), encoding='utf-8').read()).group(1)
ver = app + '.' + num
# style.css 가 바뀌었을 수 있으니 새 테마의 덮어쓰기 규칙을 다시 만든다(해시는 그 뒤에 잰다)
import subprocess
subprocess.check_call([sys.executable, os.path.join(HERE, 'tools', 'build_rui_gen.py')])


def fhash(rel):
    with open(os.path.join(HERE, 'app-html', rel), 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


s = io.open(HTML, encoding='utf-8').read()
changed = 0
for a in ASSETS:
    h = fhash(a)
    pat = re.compile(r'(?P<attr>href|src)="' + re.escape(a) + r'(?:\?v=(?P<old>[^"]*))?"')
    m = pat.search(s)
    if m and m.group('old') != h:
        changed += 1
    s, n = pat.subn(lambda m: '%s="%s?v=%s"' % (m.group('attr'), a, h), s)
    assert n == 1, 'asset %s matched %d times' % (a, n)

meta = '<meta name="app-version" content="%s">' % ver
if re.search(r'<meta name="app-version" content="[^"]*">', s):
    s = re.sub(r'<meta name="app-version" content="[^"]*">', meta, s)
else:
    s = s.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n' + meta, 1) if '<meta charset="UTF-8">' in s else re.sub(r'(<head[^>]*>)', r'\1\n' + meta, s, 1)
assert meta in s, 'app-version meta not written'

io.open(HTML, 'w', encoding='utf-8').write(s)
# (v153, G19) 다른 화면 파일(HTML)도 같은 출처 js·css 를 ?v= 로 읽는다 — Cloudflare 가 버전 없는 정적 파일을 4시간 보관한다
for other in ['api-docs.html']:
    op = os.path.join(os.path.dirname(HTML), other)
    t = io.open(op, encoding='utf-8').read()
    t = re.sub(r'(?P<attr>href|src)="(?P<a>ui/rui(?:-theme\.js|-tokens\.css|\.css))(?:\?v=[^"]*)?"', lambda m: '%s="%s?v=%s"' % (m.group('attr'), m.group('a'), fhash(m.group('a'))), t)
    io.open(op, 'w', encoding='utf-8').write(t)
print('build %s · 파일별 해시 ?v= (바뀐 파일 %d / %d)' % (ver, changed, len(ASSETS)))

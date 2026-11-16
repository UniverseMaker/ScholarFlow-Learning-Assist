# 배포

## 한 대의 PC(또는 서버)에서
```
python -m pip install -r requirements.txt
python serve.py 18162 --data-dir="D:/scholarflow-data"
```
- 기본은 이 PC 에서만(`127.0.0.1`). 같은 네트워크의 다른 PC 에서도 쓰려면 `--lan` (믿을 수 있는 네트워크에서만).
- 데이터 폴더 = 계정·프로젝트·문서·로그·백업이 모두 들어가는 곳. 폴더째 복사하면 이사가 끝나요.
- 처음 켠 뒤 관리자 비밀번호를 정하세요 → [관리자](#help:admin).

## 바깥에서 접속
리버스 프록시(예: Cloudflare Tunnel·nginx)로 `http://127.0.0.1:<포트>` 를 내보내세요. `/local-admin` 화면은 터널·공개 주소에서는 열리지 않아요.

## 업데이트
코드 폴더만 바꾸고 데이터 폴더는 그대로 두세요. 화면 파일을 고쳤다면 `python bump-assets.py <번호>`.

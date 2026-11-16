
const CONFIG = {
  // ---- LLM 연결 ----
  // ⚠️ 기본 연결 없음. 하드코딩된 엔드포인트/키를 두지 않는다.
  // 사용자가 [설정 → AI 연결]에서 LLM 프로필(JSON)을 불러와 하나를 "연결"해야
  // 비로소 AI 기능이 동작한다. 프로필은 study.llm 에 저장된다(api.js §B9).
  // 가져오기 포맷: { "type":"llm-lab-profiles", "profiles":[ { service, base_url, model,
  //   auth:{api_key}, params:{temperature,max_tokens,top_p,timeout_ms} }, ... ] }
  // (base_url + model 만 있으면 되고, 배열/단일 객체도 받는다.)
  //
  // 참고: 브라우저가 실제 User-Agent 를 자동으로 붙이므로 Cloudflare 앞단을 통과한다.
  //       (fetch 로 UA 를 수동 설정하지 말 것 — 금지 헤더라 무시됨)

  // ---- API 어댑터 계층 (api.js) ----
  // "local"  : 지금. 브라우저에서 localStorage + 직접 LLM/에셋 fetch (LocalApi).
  // "remote" : 미래. 백엔드(/api/*) 프록시 (RemoteApi). 전환 시 아래 API_BASE 설정 필요.
  API_MODE: "local",
  // RemoteApi 가 호출할 백엔드 오리진(예: "https://api.example.com"). local 모드에선 무시.
  // API_BASE: "",

  // ---- 로그인(브라우저 단독 모드 전용) ----
  // 서버(serve.py) 모드에서는 서버 계정만 쓴다. 아래 값은 서버 없이 열었을 때의 옛 동작용이다.
  ALLOW_SIGNUP: false,
  LOGIN_LOCK: true,

};

(function () {
  "use strict";
  const T = window.TOOLSETS; if (!T || !window.TK || !T.X2) return;
  const L = T.L, C = T.C, arr = T.arr, clip = T.clip, X = T.X2;
  const esc = TK.esc, $ = (id) => document.getElementById(id);
  const GL = "🌟 조사 기반 학습법", GR = "🌟 조사 기반 연구 도구";
  const uid = () => { try { return (JSON.parse(localStorage.getItem("study.session") || "{}") || {}).user_id; } catch (e) { return null; } };
  const aiOn = () => { try { return Api.llm.isConnected(); } catch (e) { return false; } };
  const errBox = (el, e) => { el.innerHTML = '<p class="lb-warn">' + esc(e && e.message ? e.message : e) + "</p>"; };
  async function oaCount(q) { try { const r = await fetch("https://api.openalex.org/works?per-page=1&select=id&search=" + encodeURIComponent(q)); if (!r.ok) return null; return ((await r.json()).meta || {}).count || 0; } catch (e) { return null; } }
  async function pool(items, n, fn) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
  // 모든 학습 자료의 내 노트·형광펜(증강 읽기·고른 메모 질문)
  function myNotes() {
    let docs = []; try { docs = ((libState.catalog || {}).docs) || []; } catch (e) { docs = []; }
    const title = (id) => { const x = docs.find((d) => d.id === id); return x ? x.title : id; };
    const out = [], u = uid();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); let m;
      try {
        if ((m = /\.tk\.lib\.notes\.(.+)$/.exec(k)) && k.indexOf("study.user." + u + ".") === 0) { const n = JSON.parse(localStorage.getItem(k)); if (n && n.t) n.t.split(/\n{2,}/).forEach((t) => { if (t.trim()) out.push({ doc: m[1], src: "📝 " + title(m[1]), text: t.trim().slice(0, 900) }); }); }
        else if ((m = /^study\.reader\.hl\.(.+)$/.exec(k))) { arr(JSON.parse(localStorage.getItem(k))).forEach((h) => { const t = h.text || h.t || h; if (t) out.push({ doc: m[1], src: "🖍 " + title(m[1]), text: String(t).slice(0, 600) }); }); }
      } catch (e) { /* 계속 */ }
    }
    return out;
  }
  const addNote = (title, md) => { const n = TK.store.get(L.key("notes"), { t: "" }); n.t = (n.t ? n.t + "\n\n" : "") + "## " + title + "\n" + md; n.at = Date.now(); TK.store.set(L.key("notes"), n); };

  /* =====================================================================
   * A. 자료 학습 13
   * =================================================================== */
  const LIBX = [
    { id: "interactive", group: GL, ico: "🎛", name: "개념 인터랙티브 모듈", desc: "지금 읽는 개념을 값을 바꾸면 그림이 바로 바뀌는 작은 실험 화면으로 만들어요(ChatGPT 식)", ai: true, inputs: [{ id: "c", label: "개념(비우면 AI 가 골라요)", placeholder: "예: 학습률과 경사하강, 복리, 정규분포" }],
      run: async (c, io, v) => {
        const t = L.text(v.scope, 6000); io.busy("실험 화면을 만드는 중…");
        let html = await TK.ai({ sys: "당신은 교육용 인터랙티브 위젯 개발자입니다. 완결된 HTML 문서 하나만 출력하세요(설명·코드펜스 없이). 외부 파일·네트워크·라이브러리 금지(순수 HTML·CSS·JS), 30KB 이하. 슬라이더·입력 2~4개를 바꾸면 SVG 나 canvas 그림과 숫자가 즉시 바뀌고, 아래에 '무엇을 보나' 2~3줄 한국어 설명. 밝은 배경, 글자 15px.", user: "개념: " + (v.c || "(아래 자료에서 가장 핵심인 수치·관계 하나)") + "\n\n[자료]\n" + t, tokens: 3800, temp: 0.4 });
        html = String(html || "").replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
        if (!/<(html|body|div|svg|canvas)/i.test(html)) throw new Error("화면을 만들지 못했어요. 다시 눌러 주세요.");
        const safe = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:">' + html;
        io.html('<iframe class="tk-ifr" sandbox="allow-scripts" title="개념 실험"></iframe><div class="lb-row"><button type="button" class="ghost-btn small-btn" id="t3IfDl">⬇ HTML 저장</button></div>', "", "개념 인터랙티브 모듈");
        io.el.querySelector("iframe").srcdoc = safe;
        $("t3IfDl").onclick = () => TK.download("개념실험.html", html, "text/html");
      } },
    { id: "tryit", group: GL, ico: "✍", name: "직접 해 보기 칸", desc: "핵심 판단은 비워 두고 내가 채우게 — 채우면 AI 가 짚어 줘요(Claude 학습 스타일)", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 7000); io.busy("빈칸 과제를 만드는 중…");
        const r = await TK.aiJSON({ sys: T.SYS_LIB, user: "자료의 핵심 판단·추론 지점 4개를 골라, 학습자가 스스로 써야 하는 과제로 만드세요(답을 알려 주지 말고 힌트만). 모범 답 핵심도 따로.\n\n" + t, shape: '{"items":[{"prompt":"","hint":"","key":"모범 답 핵심(채점용)"}]}', tokens: 1600 });
        const it = arr(r.items).slice(0, 5);
        io.html(it.map((x, i) => '<div class="rp-card"><b>' + (i + 1) + ". " + esc(x.prompt) + '</b><p class="sh-muted">💡 ' + esc(x.hint || "") + '</p><textarea data-t3t="' + i + '" rows="3" placeholder="내 생각을 써 보세요"></textarea></div>').join("") + '<div class="lb-row"><button type="button" class="primary small-btn" id="t3TyGo">✨ 짚어 받기</button></div><div id="t3TyOut" class="tk-md"></div>', "", "직접 해 보기");
        $("t3TyGo").onclick = async () => {
          const ans = it.map((x, i) => (i + 1) + ". " + x.prompt + "\n모범 핵심: " + x.key + "\n학습자: " + (io.el.querySelector('[data-t3t="' + i + '"]').value || "(비움)")).join("\n\n");
          const o = $("t3TyOut"); o.innerHTML = '<p class="sh-muted">보는 중…</p>';
          try { o.innerHTML = TK.md(await TK.ai({ sys: T.SYS_LIB, user: "학습자 답을 모범 핵심과 비교해 문항마다 ✓맞은 점 / ✗빠진 점 / 다음에 생각해 볼 질문 하나. 정답을 통째로 주지 말고 스스로 고치게.\n\n" + ans, tokens: 1500 }, (f) => { o.innerHTML = TK.md(f); })); } catch (e) { errBox(o, e); }
        };
      } },
    { id: "augread", group: GL, ico: "🧩", name: "증강 읽기 — 관련 옛 메모", desc: "지금 읽는 대목과 이어지는 내 예전 노트·형광펜을 다른 문서에서 찾아 옆에(Recall 식, AI 없음)",
      run: async (c, io, v) => {
        const items = myNotes().filter((x) => x.doc !== L.id());
        if (!items.length) { io.md("아직 다른 문서의 노트·형광펜이 없어요. 읽으며 🗒 노트나 🖍 형광펜을 남기면 여기서 이어져요."); return; }
        const q = L.text(v.scope === "all" ? "sec" : v.scope, 3000);
        const hits = T.bm25(items, q, 8);
        io.html(hits.length ? '<p class="tk-sum">이 대목과 이어지는 내 메모 ' + hits.length + "개 (전체 " + items.length + "개 중)</p>" + hits.map((h) => '<div class="tk-ref"><div><b>' + esc(h.src) + "</b><small>" + esc(h.text.slice(0, 260)) + '</small></div><button type="button" class="ghost-btn small-btn" data-t3open="' + esc(h.doc) + '">열기</button></div>').join("") : '<p class="sh-muted">이 대목과 이어지는 예전 메모가 없어요.</p>', hits.map((h) => "- " + h.src + ": " + h.text.slice(0, 160)).join("\n"), "증강 읽기");
        io.el.onclick = (e) => { const b = e.target.closest("[data-t3open]"); if (b && window.libOpen) libOpen(b.dataset.t3open); };
      } },
    { id: "pickask", group: GL, ico: "🗂", name: "고른 메모만 맥락으로 질문", desc: "내 노트·형광펜 중 고른 것만 AI 에게 근거로 주고 묻기(Heptabase 식)", ai: true, go: "목록 열기",
      run: async (c, io) => {
        const items = myNotes(); if (!items.length) throw new Error("아직 노트·형광펜이 없어요.");
        io.html('<p class="tk-sum">메모 ' + items.length + '개 — 근거로 쓸 것을 고르세요</p><div class="t3-pick">' + items.slice(0, 200).map((x, i) => '<label class="t3-pi"><input type="checkbox" data-t3p="' + i + '"><span><b>' + esc(x.src) + "</b> " + esc(x.text.slice(0, 140)) + "</span></label>").join("") + '</div><input id="t3PkQ" type="text" placeholder="고른 메모로 무엇을 할까요? 예: 공통점과 차이를 표로"><div class="lb-row"><button type="button" class="primary small-btn" id="t3PkGo">✨ 묻기</button></div><div id="t3PkOut" class="tk-md"></div>', "", "고른 메모만 질문");
        $("t3PkGo").onclick = async () => {
          const sel = Array.from(io.el.querySelectorAll("[data-t3p]:checked")).map((x) => items[+x.dataset.t3p]); const q = ($("t3PkQ").value || "").trim(); const o = $("t3PkOut");
          if (!sel.length || !q) { o.textContent = "메모를 고르고 질문을 써 주세요."; return; }
          o.innerHTML = '<p class="sh-muted">답하는 중…</p>';
          try { o.innerHTML = TK.md(await TK.ai({ sys: "고른 메모만 근거로 답하세요. 문장마다 [번호]로 근거를 달고, 메모에 없는 것은 '메모에 없음'.", user: "질문: " + q + "\n\n" + sel.map((x, i) => "[" + (i + 1) + "] (" + x.src + ") " + x.text).join("\n\n"), tokens: 1600 }, (f) => { o.innerHTML = TK.md(f); })); } catch (e) { errBox(o, e); }
        };
      } },
    { id: "examprep", group: GL, ico: "🎯", name: "출제 예측·학습 계획", desc: "이 자료에서 시험에 나올 곳을 가능성 순으로 짚고, 날짜별 공부 계획까지(Knowt 식)", ai: true, inputs: [{ id: "d", label: "시험까지", type: "select", options: [["3", "3일"], ["7", "1주"], ["14", "2주"], ["30", "한 달"]] }],
      run: async (c, io, v) => {
        const t = L.text(v.scope, 12000); io.busy("출제 지점을 고르는 중…");
        const r = await TK.aiJSON({ sys: T.SYS_LIB, user: "시험까지 " + v.d + "일. 아래 자료에서 출제 가능성이 높은 곳 8~12개(가능성 상/중/하, 왜, 예상 문제 형태)와 날짜별 학습 계획(인출·간격 반복 포함).\n\n" + t, shape: '{"points":[{"topic":"","likely":"상|중|하","why":"","form":"객관식|서술|계산 등"}],"plan":[{"day":"1일차","task":""}]}', tokens: 2200 });
        io.html(TK.tableHtml([["likely", "가능성"], ["topic", "지점"], ["why", "왜"], ["form", "형태"]], arr(r.points)) + "<h4>📅 학습 계획</h4>" + TK.tableHtml([["day", "날"], ["task", "할 일"]], arr(r.plan)), TK.tableMd([["likely", "가능성"], ["topic", "지점"], ["why", "왜"]], arr(r.points)) + "\n\n" + TK.tableMd([["day", "날"], ["task", "할 일"]], arr(r.plan)), "출제 예측·학습 계획");
      } },
    { id: "persona", group: GL, ico: "🎭", name: "인물·저자와 대화 + 상황극 평가", desc: "이 글의 저자·역사 인물·상황 속 상대와 대화하고, 끝나면 기준별 피드백(밀리의 서재·Coursera 식)", ai: true, inputs: [{ id: "who", label: "누구와", placeholder: "예: 이 글의 저자 / 앨런 튜링 / 내 설명을 의심하는 팀장" }, { id: "goal", label: "상황·목표(선택)", placeholder: "예: 이 개념을 3분 안에 설득하기" }], go: "대화 시작",
      run: async (c, io, v) => {
        const who = (v.who || "이 글의 저자").trim(), base = L.text(v.scope, 7000), log = [];
        const sys = "당신은 '" + who + "' 역할입니다. 그 인물의 관점·말투로 한국어로 짧게(3~5문장) 답하고, 아래 자료에 근거하세요. 자료 밖 사실은 지어내지 말고 모르면 모른다고. " + (v.goal ? "상황: " + v.goal + ". 사용자가 목표를 이루도록 적당히 반박·질문하세요." : "") + "\n\n[자료]\n" + base;
        const paint = () => io.html('<div class="t3-chat">' + log.map((m) => '<p class="' + m.r + '"><b>' + (m.r === "u" ? "나" : esc(who)) + "</b> " + TK.md(m.t) + "</p>").join("") + '</div><div class="t3-row"><input id="t3PsIn" type="text" placeholder="말을 걸어 보세요 (Enter)"><button type="button" class="primary small-btn" id="t3PsGo">보내기</button><button type="button" class="ghost-btn small-btn" id="t3PsEnd">끝내고 평가</button></div><div id="t3PsOut" class="tk-md"></div>', log.map((m) => (m.r === "u" ? "나: " : who + ": ") + m.t).join("\n\n"), who + "와 대화");
        const say = async () => {
          const i = $("t3PsIn"), t = (i.value || "").trim(); if (!t) return; i.value = ""; log.push({ r: "u", t: t }); paint();
          try { const msgs = log.map((m) => (m.r === "u" ? "사용자: " : who + ": ") + m.t).join("\n"); const a = await TK.ai({ sys: sys, user: msgs + "\n" + who + ":", tokens: 500, temp: 0.6 }); log.push({ r: "a", t: a }); } catch (e) { log.push({ r: "a", t: "⚠ " + e.message }); }
          paint(); bind(); setTimeout(() => { const x = $("t3PsIn"); if (x) x.focus(); }, 30);
        };
        const bind = () => {
          $("t3PsGo").onclick = say; $("t3PsIn").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); say(); } };
          $("t3PsEnd").onclick = async () => { const o = $("t3PsOut"); o.innerHTML = '<p class="sh-muted">평가 중…</p>'; try { o.innerHTML = TK.md(await TK.ai({ user: "다음 대화에서 사용자의 이해·설명·논증을 평가하세요. ## 기준별 점수(이해의 정확성·근거 사용·논리·상대 반응 대응, 각 5점) ## 잘한 점 ## 고칠 점 ## 다음에 해 볼 한 마디" + (v.goal ? "\n상황 목표: " + v.goal : "") + "\n\n" + log.map((m) => (m.r === "u" ? "사용자: " : who + ": ") + m.t).join("\n"), tokens: 1200 })); } catch (e) { errBox(o, e); } };
        };
        paint(); bind();
      } },
    { id: "rubricw", group: GL, ico: "📐", name: "루브릭 서술형 채점·재도전", desc: "AI 가 서술형 문제와 채점 기준을 만들고, 내 답을 기준별로 채점 — 고쳐 다시 내기(Coursera 식)", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 7000); io.busy("문제와 기준을 만드는 중…");
        const r = await TK.aiJSON({ sys: T.SYS_LIB, user: "이 자료로 서술형 문제 1개와 채점 기준(3~4개, 기준마다 배점·만점 조건)을 만드세요.\n\n" + t, shape: '{"q":"","rubric":[{"c":"기준","pts":3,"full":"만점 조건"}]}', tokens: 1000 });
        let tries = 0;
        io.html('<div class="rp-card"><b>📝 ' + esc(r.q) + "</b>" + TK.tableHtml([["c", "기준"], ["pts", "배점"], ["full", "만점 조건"]], arr(r.rubric)) + '</div><textarea id="t3RwA" rows="6" placeholder="답을 쓰세요"></textarea><div class="lb-row"><button type="button" class="primary small-btn" id="t3RwGo">채점</button></div><div id="t3RwOut"></div>', "", "루브릭 서술형");
        $("t3RwGo").onclick = async () => {
          const a = ($("t3RwA").value || "").trim(), o = $("t3RwOut"); if (a.length < 20) { o.textContent = "조금 더 써 주세요."; return; }
          tries++; o.innerHTML = '<p class="sh-muted">채점 중…</p>';
          try {
            const g = await TK.aiJSON({ user: "문제: " + r.q + "\n기준: " + JSON.stringify(r.rubric) + "\n자료 요지: " + t.slice(0, 3000) + "\n\n학생 답:\n" + a, shape: '{"rows":[{"c":"","got":0,"pts":0,"why":"","fix":""}],"total":0,"max":0,"next":"다시 쓸 때 가장 먼저 고칠 것"}', tokens: 1200 });
            o.innerHTML = '<p class="tk-big">' + (g.total || 0) + "<small> / " + (g.max || 0) + " · " + tries + "번째</small></p>" + TK.tableHtml([["c", "기준"], ["got", "점수"], ["why", "이유"], ["fix", "고칠 점"]], arr(g.rows)) + '<p>➡ <b>' + esc(g.next || "") + '</b> — 위 답을 고쳐 다시 채점받아 보세요.</p>';
          } catch (e) { errBox(o, e); }
        };
      } },
    { id: "lecture", group: GL, ico: "🎙", name: "받아쓰기 강의 노트", desc: "강의·회의를 들으며 실시간으로 받아 적고, 끝나면 정리 노트와 복습 질문으로(에이닷 노트 식)", ai: true, go: "준비",
      run: async (c, io) => {
        let txt = ""; const rec = X.stt((fin, interim) => { txt = fin; const x = $("t3LcT"); if (x) x.value = fin + interim; });
        io.html((rec ? '<div class="lb-row"><button type="button" class="primary small-btn" id="t3LcGo">🎤 받아쓰기 시작</button><button type="button" class="ghost-btn small-btn" id="t3LcSt">■ 멈춤</button><span class="sh-muted" id="t3LcS">준비</span></div>' : '<p class="lb-warn">이 브라우저는 음성 인식이 안 돼요(크롬·엣지 권장). 아래에 붙여 넣어도 돼요.</p>') + '<textarea id="t3LcT" rows="9" placeholder="여기에 받아 적혀요"></textarea><div class="lb-row"><button type="button" class="primary small-btn" id="t3LcMk">✨ 노트로 정리</button></div><div id="t3LcOut" class="tk-md"></div>', "", "받아쓰기 강의 노트");
        io.el.onclick = async (e) => {
          if (e.target.id === "t3LcGo" && rec) { rec.start(); $("t3LcS").textContent = "🔴 듣는 중"; }
          if (e.target.id === "t3LcSt" && rec) { rec.stop(); $("t3LcS").textContent = "멈춤"; }
          if (e.target.id === "t3LcMk") {
            if (rec) rec.stop(); const raw = ($("t3LcT").value || "").trim(), o = $("t3LcOut"); if (raw.length < 40) { o.textContent = "받아 적은 내용이 너무 짧아요."; return; }
            o.innerHTML = '<p class="sh-muted">정리 중…</p>';
            try { const m = await TK.ai({ user: "받아쓰기(말이라 군더더기·오인식이 있어요)를 강의 노트로: ## 핵심 요지 3줄 ## 내용 정리(소제목·불릿) ## 용어 ## 복습 질문 5개(답은 접어서 끝에)\n\n" + clip(raw, 14000), tokens: 2200 }, (f) => { o.innerHTML = TK.md(f); }); o.innerHTML = TK.md(m) + (L.id() ? '<div class="lb-row"><button type="button" class="ghost-btn small-btn" id="t3LcSave">🗒 이 문서 노트에 붙이기</button></div>' : ""); const sv = $("t3LcSave"); if (sv) sv.onclick = () => { addNote("강의 노트", m); sv.textContent = "✓ 붙였어요"; }; } catch (er) { errBox(o, er); }
          }
        };
      } },
    { id: "wcoach", group: GL, ico: "🧭", name: "단계별 글쓰기 코치", desc: "개요 → 초안 → 고쳐쓰기를 단계마다 코치 — 큰 붙여넣기는 알려 줘요(Khanmigo 식)", ai: true, inputs: [{ id: "topic", label: "주제·과제", placeholder: "예: 이 자료를 바탕으로 '데이터 메시의 장단점' 에세이" }], go: "시작",
      run: async (c, io, v) => {
        const ref = (() => { try { return L.text(v.scope, 5000); } catch (e) { return ""; } })(); let step = 0;
        const STEPS = [["개요", "주장 한 문장과 근거 3개를 개요로 써 보세요."], ["초안", "개요를 바탕으로 초안을 쓰세요(문단 3~5개)."], ["고쳐쓰기", "피드백을 반영해 고쳐 쓰세요."]];
        const paint = (fb) => io.html('<p class="tk-sum">' + STEPS.map((s, i) => (i === step ? "<b>● " : "○ ") + s[0] + (i === step ? "</b>" : "")).join(" → ") + '</p><p class="sh-muted">' + esc(STEPS[step][1]) + '</p><textarea id="t3WcT" rows="9"></textarea><p class="lb-warn hidden" id="t3WcP">큰 덩어리를 붙여 넣었어요 — 내 말로 다시 써야 실력이 늘어요.</p><div class="lb-row"><button type="button" class="primary small-btn" id="t3WcGo">✨ 피드백</button>' + (step < 2 ? '<button type="button" class="ghost-btn small-btn" id="t3WcNx">다음 단계 →</button>' : "") + '</div><div class="tk-md" id="t3WcOut">' + (fb || "") + "</div>", "", "글쓰기 코치");
        const bind = () => {
          const ta = $("t3WcT"); ta.value = TK.store.get("t3.wc." + step, ""); ta.oninput = () => TK.store.set("t3.wc." + step, ta.value);
          ta.addEventListener("paste", (e) => { const t = (e.clipboardData && e.clipboardData.getData("text")) || ""; if (t.length > 200) $("t3WcP").classList.remove("hidden"); });
          $("t3WcGo").onclick = async () => { const o = $("t3WcOut"); o.innerHTML = '<p class="sh-muted">읽는 중…</p>'; try { o.innerHTML = TK.md(await TK.ai({ user: "과제: " + (v.topic || "") + "\n단계: " + STEPS[step][0] + "\n대신 써 주지 말고 코치처럼: ## 잘된 점 ## 가장 먼저 고칠 1가지(왜·어떻게) ## 생각해 볼 질문 2개" + (ref ? "\n\n[참고 자료]\n" + ref : "") + "\n\n[학습자 글]\n" + ta.value, tokens: 1100 }, (f) => { o.innerHTML = TK.md(f); })); } catch (e) { errBox(o, e); } };
          const nx = $("t3WcNx"); if (nx) nx.onclick = () => { step++; paint(); bind(); };
        };
        paint(); bind();
      } },
    { id: "listenask", group: GL, ico: "🎧", name: "듣다가 말로 묻기 · 문장 저장", desc: "지금 부분을 읽어 주다가 🎤 로 바로 묻고(답도 소리로), 📌 로 그 문장을 노트에 저장(Speechify·Snipd 식)", go: "읽어 주기",
      run: async (c, io, v) => {
        const ss = X.sentences(L.text(v.scope === "all" ? "sec" : v.scope, 8000)).filter((x) => x.length > 4).slice(0, 120); if (!ss.length) throw new Error("읽을 글이 없어요.");
        let i = 0, playing = false; const syn = window.speechSynthesis;
        const rec = X.stt(() => {});
        const next = () => { if (!playing || i >= ss.length) { playing = false; upd(); return; } const u = new SpeechSynthesisUtterance(ss[i]); u.lang = /[가-힣]/.test(ss[i]) ? "ko-KR" : "en-US"; u.onend = () => { if (playing) { i++; next(); } }; syn.speak(u); upd(); };
        const upd = () => { const x = $("t3LaNow"); if (x) x.innerHTML = "<b>" + (i + 1) + " / " + ss.length + "</b> " + esc(ss[Math.min(i, ss.length - 1)]); };
        io.html('<div class="rp-card" id="t3LaNow"></div><div class="lb-row"><button type="button" class="primary small-btn" id="t3LaP">▶ 읽기</button><button type="button" class="ghost-btn small-btn" id="t3LaS">⏸ 멈춤</button><button type="button" class="ghost-btn small-btn" id="t3LaQ"' + (rec && aiOn() ? "" : " disabled") + '>🎤 말로 묻기</button><button type="button" class="ghost-btn small-btn" id="t3LaK">📌 이 문장 저장</button></div><div id="t3LaOut" class="tk-md"></div>', "", "듣다가 묻기");
        upd();
        io.el.onclick = async (e) => {
          const id = e.target.id;
          if (id === "t3LaP") { syn.cancel(); playing = true; next(); }
          if (id === "t3LaS") { playing = false; syn.cancel(); upd(); }
          if (id === "t3LaK") { addNote("들으며 저장", "> " + ss[i]); $("t3LaOut").innerHTML = '<p class="sh-muted">✓ 노트에 저장: “' + esc(ss[i].slice(0, 80)) + "”</p>"; }
          if (id === "t3LaQ" && rec) {
            playing = false; syn.cancel(); const o = $("t3LaOut"); o.innerHTML = '<p class="sh-muted">🔴 말하세요… (다 말하면 다시 누르기)</p>';
            if (!e.target.dataset.on) { rec.start(); e.target.dataset.on = "1"; e.target.textContent = "■ 다 말함"; return; }
            rec.stop(); e.target.dataset.on = ""; e.target.textContent = "🎤 말로 묻기"; const q = rec.text().trim(); if (!q) { o.textContent = "못 알아들었어요."; return; }
            try { const a = await TK.ai({ sys: T.SYS_LIB + " 2~4문장, 말하듯이.", user: "지금 듣던 문장: " + ss[i] + "\n주변: " + ss.slice(Math.max(0, i - 3), i + 3).join(" ") + "\n\n질문: " + q, tokens: 500 }); o.innerHTML = "<p><b>🙋 " + esc(q) + "</b></p>" + TK.md(a); X.speak(a); } catch (er) { errBox(o, er); }
          }
        };
      } },
    { id: "storybook", group: GL, ico: "📖", name: "이야기책으로", desc: "지금 부분을 그림(이모지)과 함께 6쪽짜리 이야기책으로 — 소리로 읽어 줘요(Gemini Storybook 식)", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 6000); io.busy("이야기를 쓰는 중…");
        const r = await TK.aiJSON({ sys: T.SYS_LIB, user: "이 내용을 초등 고학년도 이해할 이야기책 6쪽으로. 내용은 정확하게, 쪽마다 2~3문장과 장면 이모지 2~3개.\n\n" + t, shape: '{"title":"","pages":[{"emoji":"🚀🌍","text":""}]}', tokens: 1600, temp: 0.6 });
        const ps = arr(r.pages);
        io.html("<h4>" + esc(r.title || "이야기") + '</h4><div class="t3-story">' + ps.map((p, i) => '<div class="t3-pg"><span class="t3-em">' + esc(p.emoji || "📘") + "</span><p>" + esc(p.text) + '</p><button type="button" class="icon-mini" data-t3say="' + i + '" aria-label="읽어 주기">🔊</button><small>' + (i + 1) + "</small></div>").join("") + "</div>", ps.map((p, i) => (i + 1) + ". " + p.text).join("\n"), "이야기책");
        io.el.onclick = (e) => { const b = e.target.closest("[data-t3say]"); if (b) X.speak(ps[+b.dataset.t3say].text, 0.95); };
      } },
    { id: "arcade", group: GL, ico: "🕹", name: "짝 맞추기 도전", desc: "용어와 뜻을 시간 안에 짝지어요 — 틀리면 다시 섞어요(StudyFetch Arcade 식)", ai: true,
      run: async (c, io, v) => {
        const t = L.text(v.scope, 7000); io.busy("카드를 만드는 중…");
        const r = await TK.aiJSON({ user: "자료의 핵심 용어 8개와 짧은 뜻(20자 이내).\n\n" + t, shape: '{"pairs":[{"t":"","d":""}]}', tokens: 900 });
        const P = arr(r.pairs).slice(0, 8); if (P.length < 3) throw new Error("용어를 충분히 뽑지 못했어요.");
        let pick = null, done = 0, miss = 0; const t0 = Date.now();
        const cards = P.map((p, i) => ({ k: i, s: p.t, w: "t" })).concat(P.map((p, i) => ({ k: i, s: p.d, w: "d" }))).sort(() => Math.random() - 0.5);
        io.html('<p class="tk-sum" id="t3ArS">짝을 찾으세요 — 0 / ' + P.length + '</p><div class="t3-ar">' + cards.map((c2, i) => '<button type="button" class="t3-ac ' + c2.w + '" data-t3a="' + i + '">' + esc(c2.s) + "</button>").join("") + "</div>", P.map((p) => "- " + p.t + ": " + p.d).join("\n"), "짝 맞추기");
        io.el.onclick = (e) => {
          const b = e.target.closest("[data-t3a]"); if (!b || b.disabled) return; const c2 = cards[+b.dataset.t3a];
          if (!pick) { pick = { b: b, c: c2 }; b.classList.add("on"); return; }
          if (pick.b === b) { b.classList.remove("on"); pick = null; return; }
          if (pick.c.k === c2.k && pick.c.w !== c2.w) { pick.b.disabled = b.disabled = true; pick.b.classList.add("ok"); b.classList.add("ok"); done++; }
          else { miss++; const a = pick.b; a.classList.add("bad"); b.classList.add("bad"); setTimeout(() => { a.classList.remove("bad", "on"); b.classList.remove("bad"); }, 500); }
          pick.b.classList.remove("on"); pick = null;
          $("t3ArS").textContent = done === P.length ? "🎉 다 맞췄어요 — " + Math.round((Date.now() - t0) / 1000) + "초 · 틀림 " + miss + "번" : "짝을 찾으세요 — " + done + " / " + P.length + (miss ? " · 틀림 " + miss : "");
        };
      } },
    { id: "interest", group: GL, ico: "🎨", name: "관심사 맞춤 다시 쓰기", desc: "내용은 그대로, 예시만 내 관심사로 바꿔 다시 써요(Google Learn Your Way 식)", ai: true, inputs: [{ id: "i", label: "내 관심사", placeholder: "예: 축구, 요리, 게임 개발, 주식" }, { id: "lv", label: "수준", type: "select", options: [["입문", "입문"], ["중급", "중급"], ["심화", "심화"]] }],
      run: async (c, io, v) => {
        if (!v.i.trim()) throw new Error("관심사를 적어 주세요.");
        const t = L.text(v.scope, 7000); io.busy("다시 쓰는 중…");
        io.md(await TK.ai({ sys: T.SYS_LIB, user: "아래 자료를 '" + v.lv + "' 수준 학습자용으로 다시 쓰세요. 개념·수치·정의는 그대로 두고 예시·비유만 '" + v.i + "' 에서 가져오세요. 끝에 '원래 자료와 바뀐 것' 2줄.\n\n" + t, tokens: 2200 }, (f) => io.stream(f)), "관심사 맞춤 — " + v.i);
      } },
  ];

  /* =====================================================================
   * B. 연구지원 12
   * =================================================================== */
  const SYS_R = T.SYS_R;
  const docSecs = () => { const d = C().doc(); if (!d || !d.sections.some((s) => (s.body || "").trim())) throw new Error("[📝 문서] 에 내용이 있는 문서를 먼저 여세요(또는 자료 보기의 작업 문서)."); return d; };
  const RNDX = [
    { id: "gapgrid", group: GR, ico: "🧱", name: "연구 공백 격자", desc: "하위 주제 × 연구 차원 격자에 논문 수(OpenAlex)를 칠해 빈 칸(공백)을 찾고, 칸을 누르면 그 교차점 논문(Consensus 식)", ai: true, inputs: [{ id: "q", label: "주제(비우면 프로젝트에서)", placeholder: "예: urban disaster AI foundation model" }],
      run: async (c, io, v) => {
        const g = v.q.trim() ? "" : await T.ground("목표 핵심 기술 연구 내용", 8, 6000).catch(() => "");
        io.busy("격자를 설계하는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "주제: " + (v.q || "(아래 자료)") + "\n하위 주제 5개와 연구 차원 5개(예: 데이터셋, 방법, 평가, 실증 적용, 한계·안전)로 격자를 만들고, 각 칸의 영어 검색어를 주세요." + g, shape: '{"rows":[{"name":"","en":""}],"cols":[{"name":"","en":""}]}', tokens: 1000 });
        const R = arr(r.rows).slice(0, 6), K = arr(r.cols).slice(0, 6); const cells = []; R.forEach((a, i) => K.forEach((b, j) => cells.push({ i: i, j: j, q: a.en + " " + b.en })));
        io.busy("OpenAlex 에서 칸마다 논문 수를 세는 중… (" + cells.length + "칸)");
        const n = await pool(cells, 5, (x) => oaCount(x.q)); cells.forEach((x, k) => { x.n = n[k]; });
        const mx = Math.max(1, ...cells.map((x) => x.n || 0));
        const color = (k) => k == null ? "var(--surface-2)" : "color-mix(in srgb, var(--accent) " + Math.round(8 + 80 * Math.log10(k + 1) / Math.log10(mx + 1)) + "%, var(--surface))";
        io.html('<p class="tk-sum">칸이 옅을수록 연구가 적어요 — 누르면 그 교차점 논문</p><div class="tk-tblw"><table class="t3-grid"><tr><th></th>' + K.map((b) => "<th>" + esc(b.name) + "</th>").join("") + "</tr>" + R.map((a, i) => "<tr><th>" + esc(a.name) + "</th>" + K.map((b, j) => { const x = cells.find((y) => y.i === i && y.j === j); return '<td style="background:' + color(x.n) + '"><button type="button" data-t3g="' + esc(x.q) + '">' + (x.n == null ? "?" : x.n.toLocaleString()) + (x.n != null && x.n < mx * 0.02 ? " ⬜" : "") + "</button></td>"; }).join("") + "</tr>").join("") + '</table></div><p class="sh-muted">⬜ = 상위 칸의 2% 미만 — 공백 후보</p><div id="t3GgOut"></div>',
          TK.tableMd([["r", "하위 주제"]].concat(K.map((b, j) => ["c" + j, b.name])), R.map((a, i) => { const o = { r: a.name }; K.forEach((b, j) => { o["c" + j] = (cells.find((y) => y.i === i && y.j === j) || {}).n; }); return o; })), "연구 공백 격자");
        io.el.onclick = async (e) => { const b = e.target.closest("[data-t3g]"); if (!b) return; const o = $("t3GgOut"); o.innerHTML = '<p class="sh-muted">찾는 중…</p>'; try { const ws = await X.openalex(b.dataset.t3g, 6); o.innerHTML = "<h4>" + esc(b.dataset.t3g) + "</h4>" + (ws.map((w) => '<div class="tk-ref"><div><b>' + esc(w.title) + "</b><small>" + esc(w.authors) + " · " + w.year + " · 인용 " + w.cited + "</small></div></div>").join("") || '<p class="sh-muted">논문이 거의 없어요 — 공백일 수 있어요.</p>'); } catch (er) { errBox(o, er); } };
      } },
    { id: "rebut", group: GR, ico: "🔁", name: "재지원 심사평 대응표", desc: "이전 심사평을 붙여 넣으면 지적마다 지금 계획서에서 다뤘는지(근거 쪽)·안 다뤘으면 보완 문안(Grant Hawk 식)", ai: true, inputs: [{ id: "rev", label: "이전 심사평", type: "textarea", rows: 7, placeholder: "심사 의견을 그대로 붙여 넣으세요" }],
      run: async (c, io, v) => {
        if (v.rev.trim().length < 20) throw new Error("이전 심사평을 붙여 넣어 주세요.");
        io.busy("지적을 나누는 중…");
        const cs = arr((await TK.aiJSON({ user: "다음 심사평을 독립된 지적 사항으로 나누세요(원문에 가깝게).\n\n" + v.rev, shape: '{"items":[""]}', tokens: 900 })).items).slice(0, 15);
        const cx = C(), doc = cx.docText(), blocks = [];
        for (const it of cs) { const ev = await cx.retrieve(it, 3, 1500); blocks.push("지적: " + it + "\n근거 후보:\n" + ev.map((e) => "(" + e.name + (e.p ? " p." + e.p : "") + ") " + e.text.slice(0, 400)).join("\n")); }
        io.busy("대응을 판정하는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "지적마다 지금 계획서(자료·작업 문서)에서 다뤄졌는지 판정하세요. 반영됨/일부/미반영, 근거(파일 p.), 미반영·일부면 바로 넣을 보완 문안(2~3문장).\n\n" + blocks.join("\n\n") + (doc ? "\n\n[작업 문서]\n" + clip(doc, 5000) : ""), shape: '{"rows":[{"c":"","st":"반영됨|일부|미반영","where":"","fix":""}]}', tokens: 2600 });
        const rows = arr(r.rows).map((x) => Object.assign({}, x, { st: (x.st === "반영됨" ? "🟢 " : x.st === "일부" ? "🟡 " : "🔴 ") + x.st }));
        io.table([["st", "상태"], ["c", "이전 지적"], ["where", "지금 근거"], ["fix", "보완 문안"]], rows, "재지원 심사평 대응표", { before: '<p class="tk-sum">지적 ' + rows.length + "개 — 🔴 미반영 " + rows.filter((x) => /미반영/.test(x.st)).length + "</p>" });
      } },
    { id: "peer5", group: GR, ico: "🔬", name: "5관점 모의 동료 심사", desc: "독창성·방법론·논리·의의·한계를 나눠 맡은 심사자 5명 + 종합(Liner 식)", ai: true,
      run: async (c, io) => {
        const g = await T.ground("목표 방법 차별성 성과 한계 위험", 12, 9000); const P = [["독창성", "선행 연구 대비 새로움"], ["방법론", "설계·데이터·평가의 엄밀성"], ["논리", "주장→근거→결론의 연결"], ["의의", "학술·산업·사회 파급"], ["한계", "빠진 위험·가정·반례"]]; const out = [];
        for (let i = 0; i < P.length; i++) { io.busy("심사자 " + (i + 1) + "/5 — " + P[i][0]); const r = await TK.aiJSON({ sys: SYS_R + " 당신은 '" + P[i][0] + "' 전담 심사자입니다(" + P[i][1] + "만 봄). 후하게 주지 마세요.", user: "1~5점과 근거(파일 p.), 문제 2~3개, 고칠 방법." + g, shape: '{"score":0,"issues":[""],"fix":[""],"cite":""}', tokens: 900 }); out.push({ k: P[i][0], s: +r.score || 0, iss: arr(r.issues).join(" / "), fix: arr(r.fix).join(" / "), cite: r.cite || "" }); }
        io.busy("종합 의견…");
        const sum = await TK.ai({ sys: SYS_R, user: "다섯 심사 결과를 종합: ## 판정(채택/수정 후 채택/재심) ## 가장 시급한 수정 3가지\n\n" + JSON.stringify(out), tokens: 700 });
        io.html('<div class="tk-panel-top"><div>' + X.radarSvg(out.map((x) => x.k), out.map((x) => x.s), 5) + '</div><div class="tk-md">' + TK.md(sum) + "</div></div>" + TK.tableHtml([["k", "관점"], ["s", "점수"], ["iss", "문제"], ["fix", "고칠 방법"], ["cite", "근거"]], out), sum + "\n\n" + TK.tableMd([["k", "관점"], ["s", "점수"], ["iss", "문제"], ["fix", "고칠 방법"]], out), "5관점 모의 동료 심사");
      } },
    { id: "survey", group: GR, ico: "📋", name: "설문 시뮬레이터", desc: "설문 문항을 붙여 넣으면 다양한 가상 응답자로 미리 돌려 모호·유도·이중 질문을 찾아요(Liner 식, 사전 점검용)", ai: true, inputs: [{ id: "qs", label: "설문 문항", type: "textarea", rows: 7, placeholder: "한 줄에 한 문항" }, { id: "who", label: "대상", placeholder: "예: 지자체 재난 담당 공무원" }],
      run: async (c, io, v) => {
        if (v.qs.trim().length < 10) throw new Error("문항을 붙여 넣어 주세요.");
        io.busy("가상 응답자 12명이 답하는 중…");
        const r = await TK.aiJSON({ user: "대상: " + (v.who || "일반") + "\n배경·성향이 다른 가상 응답자 12명을 만들어 각 문항에 답하게 하고, 문항마다 응답 분포 요약과 문제(모호함·유도·이중 질문·보기 누락·기억 의존 등), 고친 문항을 주세요. 실제 응답을 대신하지 않는 사전 점검입니다.\n\n" + v.qs, shape: '{"personas":[""],"items":[{"q":"","spread":"","issues":"","fix":""}]}', tokens: 3000 });
        io.table([["q", "문항"], ["spread", "가상 응답 분포"], ["issues", "문제"], ["fix", "고친 문항"]], arr(r.items), "설문 시뮬레이터", { before: '<p class="sh-muted">가상 응답자: ' + arr(r.personas).map(esc).join(" · ") + " — 사전 점검용(실제 응답을 대신하지 않아요)</p>" });
      } },
    { id: "satur", group: GR, ico: "📈", name: "검색 포화도", desc: "검색어를 바꿔 여러 번 찾고 겹침으로 '관련 논문 중 몇 %를 찾았나' 추정(Undermind 식, 포획-재포획)", inputs: [{ id: "q", label: "주제(영어 권장)", placeholder: "예: retrieval augmented generation evaluation" }, { id: "alts", label: "다른 표현(선택, 한 줄에 하나 — 비우면 AI 가 만듦)", type: "textarea", rows: 3 }], go: "추정",
      run: async (c, io, v) => {
        if (!v.q.trim()) throw new Error("주제를 적어 주세요.");
        let qs = [v.q.trim()].concat(v.alts.split("\n").map((x) => x.trim()).filter(Boolean));
        if (qs.length < 3 && aiOn()) { try { qs = qs.concat(arr((await TK.aiJSON({ user: "논문 검색 표현 4개를 영어로(같은 주제, 다른 용어·관점).\n주제: " + v.q, shape: '{"q":[""]}', tokens: 300 })).q)).slice(0, 5); } catch (e) { /* 계속 */ } }
        if (qs.length < 2) throw new Error("다른 표현을 한 줄 이상 적어 주세요(또는 AI 연결).");
        io.busy("검색 " + qs.length + "번…");
        const sets = await pool(qs, 3, async (q) => (await X.openalex(q, 50)).map((w) => (w.doi || w.title).toLowerCase()));
        const all = new Set(); sets.forEach((s) => s.forEach((x) => all.add(x)));
        const est = []; for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) { const m = sets[a].filter((x) => sets[b].indexOf(x) >= 0).length; if (m) est.push(sets[a].length * sets[b].length / m); }
        const N = est.length ? Math.round(est.reduce((x, y) => x + y, 0) / est.length) : null, sat = N ? Math.min(100, Math.round(all.size / N * 100)) : null;
        io.html('<p class="tk-big">' + (sat == null ? "매우 낮음" : sat + "%") + '<small> 포화도 추정</small></p><p>찾은 서로 다른 논문 ' + all.size + "편 · 추정 전체 " + (N ? N + "편" : "알 수 없음") + (sat == null ? " — 검색끼리 겹치는 논문이 한 편도 없어요. 아직 이 주제의 일부만 보고 있다는 뜻이니 표현을 늘려 다시 재 보세요." : "") + '</p><p class="sh-muted">50%보다 낮으면 검색어를 더 넓혀 보세요. 추정은 검색 상위 50편끼리의 겹침으로 낸 대략값이에요.</p>' + TK.tableHtml([["q", "검색 표현"], ["n", "찾은 수"]], qs.map((q, i) => ({ q: q, n: sets[i].length }))), "포화도 " + sat + "% (찾음 " + all.size + " / 추정 " + N + ")", "검색 포화도");
      } },
    { id: "reader", group: GR, ico: "👥", name: "독자 반응 예측", desc: "심사위원·경영진·현장 실무자 등 정한 독자가 절마다 어떻게 받아들일지(이해·설득·질문) 예측(Grammarly 식)", ai: true, inputs: [{ id: "who", label: "독자", type: "select", options: [["국가 R&D 심사위원(기술 전문가)", "심사위원(기술)"], ["공무원·정책 담당자", "정책 담당자"], ["경영진(비전문가, 바쁨)", "경영진"], ["현장 실무자", "현장 실무자"], ["일반 시민", "일반 시민"]] }],
      run: async (c, io, v) => {
        const d = docSecs(); io.busy("독자가 읽는 중…");
        const r = await TK.aiJSON({ user: "독자: " + v.who + ". 이 독자로서 각 절을 읽고 반응을 예측하세요: 이해도·설득력(1~5), 첫 반응 한 줄, 떠오를 질문, 고칠 점.\n\n" + d.sections.map((s, i) => "[" + i + "] " + s.h + "\n" + clip(s.body || "", 1500)).join("\n\n"), shape: '{"rows":[{"i":0,"h":"","clear":0,"persuade":0,"react":"","ask":"","fix":""}]}', tokens: 2600 });
        io.table([["h", "절"], ["clear", "이해"], ["persuade", "설득"], ["react", "첫 반응"], ["ask", "떠오를 질문"], ["fix", "고칠 점"]], arr(r.rows), "독자 반응 — " + v.who);
      } },
    { id: "conflict", group: GR, ico: "⚖", name: "문안 충돌·낡은 값 검사", desc: "자료·문서 곳곳의 예산·기간·인력·목표 수치가 서로 어긋나거나 예전 값으로 남은 곳을 찾아요(Inventive 식)", ai: true,
      run: async (c, io) => {
        const cx = C(), ch = []; for (const q of ["총 예산 연구비 사업비 금액", "연구 기간 개시 종료 연차", "참여 인력 연구원 수", "목표 성과지표 정량 목표치", "기관 명칭 과제명"]) { (await cx.retrieve(q, 5, 3000)).forEach((x) => { if (!ch.some((y) => y.fid === x.fid && y.p === x.p)) ch.push(x); }); }
        const doc = cx.docText(); if (!ch.length && !doc) throw new Error("근거로 쓸 자료가 없어요.");
        io.busy("값을 맞대 보는 중…");
        const r = await TK.aiJSON({ sys: SYS_R, user: "아래 발췌·작업 문서에서 같은 항목(예산·기간·인력·목표치·명칭 등)의 값이 서로 다르거나, 연도가 지나 낡은 값이 남은 곳을 모두 찾으세요. 값마다 출처(파일 p.).\n\n" + cx.ground(ch) + (doc ? "\n\n[작업 문서]\n" + clip(doc, 5000) : ""), shape: '{"rows":[{"item":"","kind":"충돌|낡음|확인 필요","values":"값1 (출처) / 값2 (출처)","fix":""}]}', tokens: 2200 });
        io.table([["kind", "종류"], ["item", "항목"], ["values", "값과 출처"], ["fix", "맞출 방법"]], arr(r.rows), "문안 충돌 검사", { before: '<p class="tk-sum">발췌 ' + ch.length + "곳 대조</p>" });
      } },
    { id: "enhance", group: GR, ico: "🗒", name: "보강 회의 노트", desc: "내가 대충 적은 메모 + 회의 받아쓰기를 합쳐 정리 — 내 글은 검정, AI 가 더한 건 회색(Granola 식)", ai: true, inputs: [{ id: "mine", label: "내 메모(짧아도 돼요)", type: "textarea", rows: 5 }, { id: "raw", label: "회의 받아쓰기·자료(선택)", type: "textarea", rows: 6 }],
      run: async (c, io, v) => {
        if (!v.mine.trim()) throw new Error("내 메모를 적어 주세요.");
        io.busy("보강하는 중…");
        const r = await TK.ai({ user: "내 메모를 뼈대로 회의 노트를 보강하세요. 내 메모 문장은 글자 그대로 두고, AI 가 보탠 부분은 반드시 ⟦ ⟧ 로 감싸세요. 구성: 결정 사항 / 할 일(담당·기한) / 논의 요지 / 남은 질문.\n\n[내 메모]\n" + v.mine + (v.raw ? "\n\n[받아쓰기·자료]\n" + clip(v.raw, 12000) : ""), tokens: 2200 });
        const html = TK.md(r).replace(/⟦([\s\S]*?)⟧/g, '<span class="t3-ai">$1</span>');
        io.html('<p class="sh-muted">검정 = 내 메모 · <span class="t3-ai">회색 = AI 가 보탬</span></p><div class="tk-md">' + html + "</div>", r.replace(/[⟦⟧]/g, ""), "보강 회의 노트");
      } },
    { id: "rubric", group: GR, ico: "🧮", name: "루브릭 예상 점수", desc: "평가 기준표(붙여 넣거나 기본)로 작업 문서를 미리 채점하고, 점수를 올릴 고침을 바로 제시(Grammarly AI Grader 식)", ai: true, inputs: [{ id: "rb", label: "평가 기준(비우면 국가 R&D 일반 기준)", type: "textarea", rows: 4, value: "연구 목표의 명확성(20)\n연구 내용·방법의 타당성(25)\n추진 체계·역량(15)\n성과 활용·파급 효과(20)\n예산·일정의 적정성(10)\n문서 완성도(10)" }],
      run: async (c, io, v) => {
        const d = docSecs(); io.busy("채점 중…");
        const r = await TK.aiJSON({ sys: SYS_R + " 깐깐한 심사위원처럼.", user: "기준:\n" + v.rb + "\n\n기준마다 점수/만점, 근거(어느 절), 점수를 올릴 구체적 고침(바로 넣을 문장 포함).\n\n[문서]\n" + clip(C().docText(), 14000), shape: '{"rows":[{"c":"","got":0,"max":0,"why":"","raise":""}],"total":0,"max":0}', tokens: 2400 });
        io.table([["c", "기준"], ["got", "점수"], ["max", "만점"], ["why", "근거"], ["raise", "올리는 고침"]], arr(r.rows), "루브릭 예상 점수", { before: '<p class="tk-big">' + (r.total || 0) + "<small> / " + (r.max || 0) + "</small></p>" });
      } },
    { id: "confid", group: GR, ico: "🚦", name: "문단별 확신도 신호등", desc: "작업 문서 문단마다 자료 근거가 얼마나 받쳐 주는지 🟢🟡🔴 로 칠해요(Inventive 식)", ai: true,
      run: async (c, io) => {
        const d = docSecs(), cx = C(), ps = []; d.sections.forEach((s) => String(s.body || "").split(/\n{2,}/).forEach((p) => { if (p.trim().length > 30 && ps.length < 24) ps.push({ h: s.h, t: p.trim() }); }));
        io.busy("문단 " + ps.length + "개의 근거를 찾는 중…");
        for (const p of ps) p.ev = (await cx.retrieve(p.t.slice(0, 300), 2, 1200)).map((e) => "(" + e.name + (e.p ? " p." + e.p : "") + ") " + e.text.slice(0, 350)).join("\n");
        const r = await TK.aiJSON({ sys: SYS_R, user: "문단마다 근거 후보가 그 내용을 받쳐 주는 정도: 높음(직접 근거)/중간(간접·일부)/낮음(근거 없음), 이유 한 줄.\n\n" + ps.map((p, i) => "[" + i + "] " + p.t.slice(0, 600) + "\n근거 후보:\n" + (p.ev || "(없음)")).join("\n\n"), shape: '{"rows":[{"i":0,"lv":"높음|중간|낮음","why":""}]}', tokens: 2400 });
        const L2 = {}; arr(r.rows).forEach((x) => { L2[+x.i] = x; });
        const col = { 높음: "#16a34a", 중간: "#d97706", 낮음: "#dc2626" }, ico = { 높음: "🟢", 중간: "🟡", 낮음: "🔴" };
        io.html('<p class="tk-sum">🟢 ' + arr(r.rows).filter((x) => x.lv === "높음").length + " · 🟡 " + arr(r.rows).filter((x) => x.lv === "중간").length + " · 🔴 " + arr(r.rows).filter((x) => x.lv === "낮음").length + "</p>" + ps.map((p, i) => { const x = L2[i] || {}; return '<div class="t3-cf" style="border-left-color:' + (col[x.lv] || "var(--line)") + '"><small>' + (ico[x.lv] || "⚪") + " " + esc(p.h) + " — " + esc(x.why || "") + "</small><p>" + esc(p.t) + "</p></div>"; }).join(""), ps.map((p, i) => "- " + ((L2[i] || {}).lv || "?") + ": " + p.t.slice(0, 80)).join("\n"), "문단별 확신도");
      } },
    { id: "recopap", group: GR, ico: "📚", name: "쓰는 글로 논문 추천", desc: "작업 문서 내용에 맞는 논문을 찾아 '왜 관련 있나' 한 줄과 함께 — ＋ 로 참고문헌에(Keenious·Asta 식)", ai: true,
      run: async (c, io) => {
        const d = docSecs(); io.busy("검색어를 만드는 중…");
        const qs = arr((await TK.aiJSON({ user: "다음 글에 인용하면 좋을 논문을 찾을 영어 검색어 3개.\n\n" + clip(C().docText(), 5000), shape: '{"q":[""]}', tokens: 300 })).q).slice(0, 3);
        io.busy("OpenAlex 에서 찾는 중…");
        const seen = {}, ws = []; (await pool(qs, 3, (q) => X.openalex(q, 10))).forEach((l) => l.forEach((w) => { const k = (w.doi || w.title).toLowerCase(); if (!seen[k]) { seen[k] = 1; ws.push(w); } }));
        const top = ws.sort((a, b) => b.cited - a.cited).slice(0, 14);
        const why = arr((await TK.aiJSON({ user: "글의 요지와 논문 목록입니다. 논문마다 이 글의 어느 절·주장에 왜 쓸 수 있는지 한 줄(관련 없으면 '약함').\n\n[글 차례] " + d.sections.map((s) => s.h).join(" / ") + "\n\n" + top.map((w, i) => i + ". " + w.title + " (" + w.year + ") " + (w.abs || "").slice(0, 200)).join("\n"), shape: '{"why":[""]}', tokens: 1600 })).why);
        io.html(top.map((w, i) => '<div class="tk-ref"><button type="button" class="ghost-btn small-btn" data-t3b="' + i + '">＋</button><div><b>' + esc(w.title) + "</b><small>" + esc(w.authors) + " · " + w.year + " · 인용 " + w.cited + (w.doi ? ' · <a href="https://doi.org/' + esc(w.doi) + '" target="_blank" rel="noopener">DOI</a>' : "") + "</small><p>💡 " + esc(why[i] || "") + "</p></div></div>").join(""), top.map((w, i) => "- " + w.title + " (" + w.year + ") — " + (why[i] || "")).join("\n"), "쓰는 글로 논문 추천");
        io.el.onclick = (e) => { const b = e.target.closest("[data-t3b]"); if (!b) return; const w = top[+b.dataset.t3b], k = "rnd.bib." + C().pid, l = TK.store.get(k, []); if (!l.some((x) => x.title === w.title)) l.push({ title: w.title, authors: w.authors, year: w.year, venue: w.venue, doi: w.doi, url: w.url }); TK.store.set(k, l); b.textContent = "✓"; };
      } },
    { id: "deepres", group: GR, ico: "🧠", name: "조사 계획 → 심층 조사", desc: "AI 가 조사 계획(하위 질문)을 먼저 보여 주고, 고친 계획대로 프로젝트 자료+논문을 뒤져 보고서(Gemini·OpenAI deep research 식)", ai: true, inputs: [{ id: "q", label: "조사 질문", placeholder: "예: 도시 재난 대응 파운데이션 모델의 국내외 실증 사례와 한계" }, { id: "src", label: "찾을 곳", type: "select", options: [["both", "프로젝트 자료 + 논문(OpenAlex)"], ["proj", "프로젝트 자료만(신뢰 자료)"], ["oa", "논문만"]] }], go: "계획 세우기",
      run: async (c, io, v) => {
        if (!v.q.trim()) throw new Error("조사 질문을 적어 주세요.");
        io.busy("계획을 세우는 중…");
        const plan = arr((await TK.aiJSON({ sys: SYS_R, user: "질문을 답하기 위한 하위 질문 4~6개(각각 무엇을 찾을지 구체적으로)와 논문 검색용 영어 키워드.\n\n" + v.q, shape: '{"steps":[{"q":"","en":""}]}', tokens: 800 })).steps);
        io.html('<p class="tk-sum">조사 계획 — 고치거나 줄을 지우고 [조사 시작]</p><textarea id="t3DrP" rows="' + (plan.length + 2) + '">' + esc(plan.map((s) => s.q + " | " + s.en).join("\n")) + '</textarea><p class="sh-muted">한 줄 = 하위 질문 | 영어 키워드</p><div class="lb-row"><button type="button" class="primary small-btn" id="t3DrGo">🔍 조사 시작</button></div><div id="t3DrOut" class="tk-md"></div>', "", "조사 계획");
        $("t3DrGo").onclick = async () => {
          const steps = ($("t3DrP").value || "").split("\n").map((l) => l.split("|")).filter((x) => x[0].trim()).map((x) => ({ q: x[0].trim(), en: (x[1] || "").trim() })); const o = $("t3DrOut"), cx = C(), parts = [];
          for (let i = 0; i < steps.length; i++) {
            o.innerHTML = '<p class="sh-muted">' + (i + 1) + "/" + steps.length + " · " + esc(steps[i].q) + " 찾는 중…</p>";
            let p = "### " + steps[i].q + "\n";
            if (v.src !== "oa") { const ch = await cx.retrieve(steps[i].q, 4, 2500); p += ch.map((x) => "- (" + x.name + (x.p ? " p." + x.p : "") + ") " + x.text.slice(0, 450)).join("\n") + "\n"; }
            if (v.src !== "proj" && steps[i].en) { try { const ws = await X.openalex(steps[i].en, 4); p += ws.map((w) => "- [논문] " + w.title + " (" + w.authors.split(",")[0] + ", " + w.year + ") " + (w.abs || "").slice(0, 250)).join("\n"); } catch (e) { /* 계속 */ } }
            parts.push(p);
          }
          o.innerHTML = '<p class="sh-muted">보고서를 쓰는 중…</p>';
          try { const rep = await TK.ai({ sys: SYS_R, user: "질문: " + v.q + "\n\n아래 하위 질문별 수집 자료만 근거로 심층 조사 보고서를 쓰세요. ## 요약 ## 하위 질문별 결과(근거: (파일 p.) 또는 (저자, 연도)) ## 서로 엇갈리는 근거 ## 남은 공백·다음 조사\n\n" + clip(parts.join("\n\n"), 22000), tokens: 3200 }, (f) => { o.innerHTML = TK.md(f); }); o.innerHTML = TK.md(rep) + '<div class="lb-row"><button type="button" class="ghost-btn small-btn" id="t3DrDoc">📝 문서에 넣기</button></div>'; $("t3DrDoc").onclick = () => C().toDoc("심층 조사 — " + v.q, rep); } catch (e) { errBox(o, e); }
        };
      } },
  ];

  // ✨(toolsets2) 묶음 바로 뒤에 넣는다
  const after = (list, group) => { let k = -1; list.forEach((t, i) => { if (t.group === group) k = i; }); return k + 1; };
  T.LIB_TOOLS.splice.apply(T.LIB_TOOLS, [after(T.LIB_TOOLS, "✨ 새 학습법"), 0].concat(LIBX));
  T.RND_TOOLS.splice.apply(T.RND_TOOLS, [after(T.RND_TOOLS, "✨ 새 연구 도구"), 0].concat(RNDX));
})();

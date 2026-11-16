/* =============================================================================
 * paperkit.js (v105) — 논문 작업실의 LaTeX 지식·분석 도구 (화면 없음, paper.js 가 쓴다)
 *   CMDS·ENVS·PKGS        자동 완성 목록(¦ = 커서 자리)
 *   SYMBOLS               기호 판(묶음별)
 *   parseBib · labels · newcommands · outline · lint · words · diff · mathAt · render(바로 보기 HTML) · hint(오류 설명)
 * ========================================================================== */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ------------------------------------------------------------ 자동 완성 */
  // [이름, 넣을 글(¦ 커서), 설명]
  const CMDS = [
    ["section", "section{¦}", "절"], ["subsection", "subsection{¦}", "소절"], ["subsubsection", "subsubsection{¦}", "소소절"], ["chapter", "chapter{¦}", "장(report·book)"], ["paragraph", "paragraph{¦}", "문단 제목"], ["part", "part{¦}", "부"],
    ["section*", "section*{¦}", "번호 없는 절"], ["label", "label{¦}", "이름표"], ["ref", "ref{¦}", "참조"], ["eqref", "eqref{¦}", "식 참조 (1)"], ["autoref", "autoref{¦}", "자동 이름 참조"], ["pageref", "pageref{¦}", "쪽 참조"], ["cref", "cref{¦}", "cleveref 참조"],
    ["cite", "cite{¦}", "인용"], ["citep", "citep{¦}", "괄호 인용(natbib)"], ["citet", "citet{¦}", "본문 인용(natbib)"], ["footnote", "footnote{¦}", "각주"], ["url", "url{¦}", "주소"], ["href", "href{¦}{}", "링크"],
    ["textbf", "textbf{¦}", "굵게"], ["textit", "textit{¦}", "기울임"], ["emph", "emph{¦}", "강조"], ["underline", "underline{¦}", "밑줄"], ["texttt", "texttt{¦}", "고정폭"], ["textsc", "textsc{¦}", "작은 대문자"], ["textcolor", "textcolor{red}{¦}", "글자 색"], ["colorbox", "colorbox{yellow}{¦}", "배경 색"],
    ["includegraphics", "includegraphics[width=0.8\\linewidth]{¦}", "그림 넣기"], ["caption", "caption{¦}", "캡션"], ["centering", "centering", "가운데"], ["input", "input{¦}", "파일 끼워 넣기"], ["include", "include{¦}", "파일 넣기(새 쪽)"],
    ["usepackage", "usepackage{¦}", "패키지"], ["documentclass", "documentclass{¦}", "문서 종류"], ["title", "title{¦}", "제목"], ["author", "author{¦}", "저자"], ["date", "date{¦}", "날짜"], ["maketitle", "maketitle", "제목 찍기"], ["tableofcontents", "tableofcontents", "차례"], ["listoffigures", "listoffigures", "그림 차례"], ["listoftables", "listoftables", "표 차례"],
    ["bibliography", "bibliography{¦}", "참고문헌 파일"], ["bibliographystyle", "bibliographystyle{¦}", "참고문헌 양식"], ["newcommand", "newcommand{\\¦}{}", "새 명령"], ["renewcommand", "renewcommand{\\¦}{}", "명령 다시 정의"], ["newtheorem", "newtheorem{¦}{}", "정리 환경"],
    ["begin", "begin{¦}", "환경 시작"], ["end", "end{¦}", "환경 끝"], ["item", "item ¦", "목록 항목"], ["newpage", "newpage", "새 쪽"], ["clearpage", "clearpage", "쪽 비우기"], ["noindent", "noindent ", "들여쓰기 없음"], ["vspace", "vspace{¦}", "세로 간격"], ["hspace", "hspace{¦}", "가로 간격"], ["hfill", "hfill", "가로 채움"], ["vfill", "vfill", "세로 채움"], ["linewidth", "linewidth", "줄 폭"], ["textwidth", "textwidth", "본문 폭"],
    ["hline", "hline", "가로줄"], ["toprule", "toprule", "표 윗줄(booktabs)"], ["midrule", "midrule", "표 가운데 줄"], ["bottomrule", "bottomrule", "표 아랫줄"], ["cmidrule", "cmidrule(lr){¦}", "부분 줄"], ["multicolumn", "multicolumn{¦}{c}{}", "열 합치기"], ["multirow", "multirow{¦}{*}{}", "행 합치기"],
    ["frac", "frac{¦}{}", "분수"], ["dfrac", "dfrac{¦}{}", "큰 분수"], ["sqrt", "sqrt{¦}", "제곱근"], ["sum", "sum_{¦}^{}", "합"], ["prod", "prod_{¦}^{}", "곱"], ["int", "int_{¦}^{}", "적분"], ["lim", "lim_{¦}", "극한"], ["left(", "left( ¦ \\right)", "크기 맞춘 괄호"], ["mathbb", "mathbb{¦}", "칠판체 R N Z"], ["mathcal", "mathcal{¦}", "필기체"], ["mathbf", "mathbf{¦}", "굵은 수식"], ["mathrm", "mathrm{¦}", "곧은 글자"], ["operatorname", "operatorname{¦}", "연산자 이름"], ["text", "text{¦}", "수식 안 글"],
    ["hat", "hat{¦}", "모자"], ["bar", "bar{¦}", "윗줄"], ["tilde", "tilde{¦}", "물결"], ["vec", "vec{¦}", "벡터"], ["dot", "dot{¦}", "점"], ["overline", "overline{¦}", "긴 윗줄"], ["underbrace", "underbrace{¦}_{}", "아래 묶음"], ["binom", "binom{¦}{}", "이항 계수"],
    ["alpha", "alpha", "α"], ["beta", "beta", "β"], ["gamma", "gamma", "γ"], ["delta", "delta", "δ"], ["epsilon", "epsilon", "ε"], ["varepsilon", "varepsilon", "ε"], ["theta", "theta", "θ"], ["lambda", "lambda", "λ"], ["mu", "mu", "μ"], ["sigma", "sigma", "σ"], ["phi", "phi", "φ"], ["omega", "omega", "ω"], ["pi", "pi", "π"], ["eta", "eta", "η"], ["rho", "rho", "ρ"], ["tau", "tau", "τ"], ["Sigma", "Sigma", "Σ"], ["Omega", "Omega", "Ω"], ["Delta", "Delta", "Δ"],
    ["infty", "infty", "∞"], ["partial", "partial", "∂"], ["nabla", "nabla", "∇"], ["cdot", "cdot", "·"], ["times", "times", "×"], ["leq", "leq", "≤"], ["geq", "geq", "≥"], ["neq", "neq", "≠"], ["approx", "approx", "≈"], ["in", "in", "∈"], ["subseteq", "subseteq", "⊆"], ["forall", "forall", "∀"], ["exists", "exists", "∃"], ["rightarrow", "rightarrow", "→"], ["Rightarrow", "Rightarrow", "⇒"], ["mapsto", "mapsto", "↦"], ["ldots", "ldots", "…"], ["cdots", "cdots", "⋯"], ["dots", "dots", "…"],
    ["today", "today", "오늘 날짜"], ["LaTeX", "LaTeX", "LaTeX 로고"], ["thanks", "thanks{¦}", "저자 각주"], ["appendix", "appendix", "부록 시작"], ["graphicspath", "graphicspath{{¦}}", "그림 폴더"], ["setlength", "setlength{¦}{}", "길이 설정"], ["definecolor", "definecolor{¦}{HTML}{}", "색 정의"],
    ["State", "State ¦", "알고리즘 한 줄"], ["If", "If{¦}\n\\EndIf", "알고리즘 조건"], ["For", "For{¦}\n\\EndFor", "알고리즘 반복"], ["Require", "Require ¦", "알고리즘 입력"], ["Return", "Return ¦", "돌려주기"],
    ["frametitle", "frametitle{¦}", "슬라이드 제목"], ["pause", "pause", "다음 단계에 보이기"], ["alert", "alert{¦}", "강조(beamer)"], ["titlepage", "titlepage", "표지 쪽(beamer)"],
  ];
  // [이름, 안쪽(¦ 커서), 설명]
  const ENVS = [
    ["itemize", "  \\item ¦", "점 목록"], ["enumerate", "  \\item ¦", "번호 목록"], ["description", "  \\item[¦] ", "설명 목록"],
    ["equation", "  ¦", "번호 붙은 식"], ["equation*", "  ¦", "번호 없는 식"], ["align", "  ¦ &= \\\\\n  &=", "여러 줄 식(맞춤)"], ["align*", "  ¦ &= ", "여러 줄 식(번호 없음)"], ["gather", "  ¦", "가운데 여러 줄 식"], ["multline", "  ¦", "긴 식 나누기"], ["cases", "  ¦ & \\text{if } \\\\\n  & \\text{otherwise}", "경우 나누기"],
    ["figure", "  \\centering\n  \\includegraphics[width=0.8\\linewidth]{¦}\n  \\caption{}\n  \\label{fig:}", "그림"], ["table", "  \\centering\n  \\caption{¦}\n  \\label{tab:}\n  \\begin{tabular}{lcc}\n    \\toprule\n    항목 & 값1 & 값2 \\\\\n    \\midrule\n    가 & 1 & 2 \\\\\n    \\bottomrule\n  \\end{tabular}", "표"],
    ["tabular", "  ¦ &  \\\\\n", "표 몸통"], ["center", "  ¦", "가운데 정렬"], ["abstract", "  ¦", "초록"], ["quote", "  ¦", "인용 단락"], ["verbatim", "¦", "그대로 찍기"], ["minipage", "  ¦", "작은 쪽"],
    ["theorem", "  ¦", "정리"], ["lemma", "  ¦", "보조정리"], ["proof", "  ¦", "증명"], ["definition", "  ¦", "정의"], ["corollary", "  ¦", "따름정리"], ["example", "  ¦", "예"], ["remark", "  ¦", "참고"],
    ["pmatrix", "  ¦ & \\\\\n   & ", "행렬 ( )"], ["bmatrix", "  ¦ & \\\\\n   & ", "행렬 [ ]"], ["matrix", "  ¦ & \\\\\n   & ", "행렬"],
    ["algorithm", "  \\caption{¦}\n  \\begin{algorithmic}[1]\n    \\State \n  \\end{algorithmic}", "알고리즘"], ["algorithmic", "  \\State ¦", "알고리즘 몸통"], ["lstlisting", "¦", "코드"],
    ["frame", "  \\frametitle{¦}\n  ", "슬라이드(beamer)"], ["block", "  ¦", "블록(beamer)"], ["columns", "  \\column{0.5\\textwidth}\n  ¦\n  \\column{0.5\\textwidth}\n  ", "두 단(beamer)"],
    ["subfigure", "  \\includegraphics[width=\\linewidth]{¦}\n  \\caption{}", "하위 그림"], ["tikzpicture", "  ¦", "TikZ 그림"], ["axis", "  \\addplot coordinates {¦};", "pgfplots 축"], ["thebibliography", "  \\bibitem{¦} ", "직접 쓰는 참고문헌"], ["appendices", "¦", "부록"],
  ];
  const ENV_ARG = { tabular: "{lcc}", minipage: "{0.48\\textwidth}", subfigure: "{0.48\\linewidth}", block: "{제목}", frame: "", thebibliography: "{9}", algorithmic: "[1]", lstlisting: "[language=Python]", figure: "[t]", table: "[t]" };
  const PKGS = [["amsmath", "수식"], ["amssymb", "수학 기호"], ["amsthm", "정리·증명"], ["mathtools", "수식 확장"], ["graphicx", "그림"], ["booktabs", "보기 좋은 표 줄"], ["multirow", "행 합치기"], ["tabularx", "폭 맞춤 표"], ["array", "표 열 형식"], ["longtable", "여러 쪽 표"],
    ["xcolor", "색"], ["hyperref", "링크·책갈피"], ["cleveref", "똑똑한 참조"], ["geometry", "여백"], ["setspace", "줄 간격"], ["enumitem", "목록 모양"], ["titlesec", "제목 모양"], ["fancyhdr", "머리·꼬리말"], ["caption", "캡션 모양"], ["subcaption", "하위 그림"], ["float", "그림 위치 [H]"],
    ["natbib", "저자-연도 인용"], ["cite", "번호 인용 묶기"], ["url", "주소"], ["listings", "코드"], ["algorithm", "알고리즘 틀"], ["algpseudocode", "의사코드"], ["tikz", "그림 그리기"], ["pgfplots", "그래프"], ["siunitx", "단위·숫자"], ["tcolorbox", "색 상자"], ["kotex", "한국어"], ["lipsum", "더미 글"], ["mwe", "예시 그림"], ["csquotes", "따옴표"], ["microtype", "미세 조판"], ["xspace", "자동 띄어쓰기"], ["bm", "굵은 수식 기호"], ["physics", "물리 기호"], ["chemfig", "화학 구조"], ["pdfpages", "PDF 끼우기"], ["wrapfig", "글 둘러싼 그림"], ["threeparttable", "표 주석"], ["makecell", "셀 줄바꿈"], ["colortbl", "표 색"]];
  const CLASSES = [["article", "논문·짧은 글"], ["report", "보고서·학위논문(장)"], ["book", "책"], ["beamer", "발표 슬라이드"], ["IEEEtran", "IEEE"], ["elsarticle", "Elsevier"], ["tikzposter", "포스터"], ["letter", "편지"], ["standalone", "그림 한 장"]];
  const BIBSTYLES = [["plain", "번호·이름순"], ["unsrt", "번호·인용순"], ["abbrv", "번호·약어"], ["alpha", "저자 약어"], ["plainnat", "저자-연도(natbib)"], ["IEEEtran", "IEEE"], ["elsarticle-num", "Elsevier 번호"], ["apalike", "APA 비슷"]];

  /* ------------------------------------------------------------ 기호 판 */
  const SYMBOLS = {
    "그리스": "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega".split(" "),
    "연산": "pm mp times div cdot circ ast star oplus ominus otimes odot cup cap setminus wedge vee nabla partial".split(" "),
    "관계": "leq geq neq approx equiv sim simeq cong propto ll gg subset supset subseteq supseteq in notin ni perp parallel mid models".split(" "),
    "화살표": "to leftarrow rightarrow Leftarrow Rightarrow leftrightarrow Leftrightarrow mapsto implies iff uparrow downarrow longrightarrow hookrightarrow".split(" "),
    "큰 연산": ["sum_{i=1}^{n}", "prod_{i=1}^{n}", "int_{a}^{b}", "iint", "oint", "bigcup_{i}", "bigcap_{i}", "lim_{x\\to\\infty}", "max_{x}", "min_{x}", "sup", "inf", "arg\\max_{x}", "arg\\min_{x}"],
    "구조": ["frac{a}{b}", "sqrt{x}", "sqrt[n]{x}", "x^{2}", "x_{i}", "binom{n}{k}", "hat{x}", "bar{x}", "tilde{x}", "vec{x}", "dot{x}", "overline{xy}", "underbrace{x+y}_{z}", "mathbb{R}", "mathbb{E}", "mathcal{L}", "mathbf{x}", "left( x \\right)", "lVert x \\rVert", "langle x, y \\rangle"],
    "기타": "infty forall exists nexists emptyset neg angle triangle ell hbar prime dagger top bot ldots cdots vdots ddots checkmark".split(" "),
    "행렬": ["begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}", "begin{cases} x & x>0 \\\\ 0 & \\text{otherwise} \\end{cases}"],
  };

  /* ------------------------------------------------------------ 기본 분석 */
  function stripComment(line) {   // 줄 끝 % 주석 지우기(\% 는 글자)
    for (let i = 0; i < line.length; i++) { if (line[i] === "\\") { i++; continue; } if (line[i] === "%") return line.slice(0, i); }
    return line;
  }
  function argAt(s, i) {   // s[i] 가 { 일 때 짝 맞는 } 까지
    if (s[i] !== "{") return null; let d = 0;
    for (let j = i; j < s.length; j++) { const c = s[j]; if (c === "\\") { j++; continue; } if (c === "{") d++; else if (c === "}") { d--; if (!d) return [s.slice(i + 1, j), j]; } }
    return [s.slice(i + 1), s.length];
  }
  function parseBib(text, file) {
    const out = []; const s = String(text || ""); const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g; let m;
    while ((m = re.exec(s))) {
      const type = m[1].toLowerCase(); if (type === "comment" || type === "string" || type === "preamble") continue;
      let d = 1, j = re.lastIndex; for (; j < s.length && d > 0; j++) { if (s[j] === "{") d++; else if (s[j] === "}") d--; }
      const body = s.slice(re.lastIndex, j - 1); const f = {};
      body.replace(/(\w+)\s*=\s*(\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|"([^"]*)"|(\w+))/g, (x, k, v, a, b, c) => { f[k.toLowerCase()] = String(a != null ? a : b != null ? b : c || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim(); return ""; });
      out.push({ key: m[2], type: type, f: f, file: file || "", line: s.slice(0, m.index).split("\n").length, start: m.index, end: j });
      re.lastIndex = j;
    }
    return out;
  }
  function bibAll(files) { let l = []; Object.keys(files).filter((n) => /\.bib$/i.test(n)).forEach((n) => { l = l.concat(parseBib(files[n], n)); }); return l; }
  function scanAll(files, re, fn) {   // 모든 .tex 의 주석 뺀 줄에서 re 반복
    Object.keys(files).filter((n) => /\.(tex|sty|cls)$/i.test(n)).forEach((n) => {
      String(files[n]).split("\n").forEach((raw, i) => { const ln = stripComment(raw); if (!ln) return; re.lastIndex = 0; let m; while ((m = re.exec(ln))) fn(m, n, i + 1, raw); });
    });
  }
  function labels(files) { const out = []; scanAll(files, /\\label\{([^}]+)\}/g, (m, f, l, raw) => out.push({ key: m[1], file: f, line: l, ctx: raw.trim().slice(0, 90) })); return out; }
  function citeUses(files) { const out = {}; scanAll(files, /\\(?:no)?cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g, (m, f, l) => m[1].split(",").forEach((k) => { k = k.trim(); if (k) (out[k] = out[k] || []).push({ file: f, line: l }); })); return out; }
  function refUses(files) { const out = []; scanAll(files, /\\(?:ref|eqref|autoref|pageref|cref|Cref|vref|nameref)\{([^}]+)\}/g, (m, f, l) => m[1].split(",").forEach((k) => out.push({ key: k.trim(), file: f, line: l }))); return out; }
  function newcommands(files) {
    const out = []; scanAll(files, /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\{?\\([a-zA-Z@]+)\}?(?:\[(\d)\])?/g, (m) => out.push({ name: m[1], n: +(m[2] || 0) }));
    scanAll(files, /\\def\\([a-zA-Z@]+)/g, (m) => out.push({ name: m[1], n: 0 }));
    scanAll(files, /\\newtheorem\*?\{([^}]+)\}/g, (m) => out.push({ env: m[1] }));
    scanAll(files, /\\new(?:tcolorbox|environment)\{([^}]+)\}/g, (m) => out.push({ env: m[1] }));
    return out;
  }
  function resolveInput(files, name, base) {
    const n = String(name || "").trim().replace(/^\.\//, ""); const c = [n, n + ".tex"]; if (base) c.push(base + "/" + n, base + "/" + n + ".tex");
    return c.find((x) => files[x] != null) || null;
  }
  // 차례 — 본문에서 \input·\include 순서대로 따라간다. 본문에 안 걸린 .tex 도 뒤에 붙인다.
  function outline(files, main) {
    const out = [], seen = {}; const base = main && main.indexOf("/") > 0 ? main.slice(0, main.lastIndexOf("/")) : "";
    const LV = { part: -1, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
    function walk(f, depth) {
      if (!f || seen[f] || depth > 8 || files[f] == null) return; seen[f] = 1;
      String(files[f]).split("\n").forEach((raw, i) => {
        const ln = stripComment(raw);
        let m = /\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/.exec(ln);
        if (m) { const a = argAt(ln, m.index + m[0].length - 1); out.push({ lv: LV[m[1]], kind: m[1], star: !!m[2], title: clean(a ? a[0] : ""), file: f, line: i + 1 }); }
        m = /\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(ln) || /\\frametitle\{([^}]*)\}/.exec(ln);
        if (m) out.push({ lv: 3, kind: "frame", title: "▭ " + clean(m[1]), file: f, line: i + 1 });
        const re = /\\(?:input|include|subfile)\{([^}]+)\}/g; let k; while ((k = re.exec(ln))) walk(resolveInput(files, k[1], base), depth + 1);
      });
    }
    walk(main, 0);
    Object.keys(files).filter((f) => /\.tex$/.test(f) && !seen[f]).sort().forEach((f) => walk(f, 0));
    return out;
    function clean(t) { return String(t || "").replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, "").replace(/[{}$~]/g, " ").replace(/\s+/g, " ").trim() || "(제목 없음)"; }
  }

  /* ------------------------------------------------------------ 검사(컴파일 전) */
  const VERB = /^(verbatim|lstlisting|minted|comment|Verbatim)$/;
  function lint(files, main, assetNames) {
    const out = []; const add = (kind, file, line, msg) => out.push({ kind: kind, file: file, line: line, msg: msg, src: "check" });
    const texs = Object.keys(files).filter((n) => /\.tex$/i.test(n));
    const base = main && main.indexOf("/") > 0 ? main.slice(0, main.lastIndexOf("/")) : "";
    texs.forEach((f) => {
      const lines = String(files[f]).split("\n"); const stack = []; let verb = null; const braces = [];
      lines.forEach((raw, i) => {
        const L = i + 1;
        if (verb) { if (new RegExp("\\\\end\\{" + verb.replace("*", "\\*") + "\\}").test(raw)) verb = null; return; }
        const ln = stripComment(raw);
        const re = /\\(begin|end)\{([^}]+)\}/g; let m;
        while ((m = re.exec(ln))) {
          if (m[1] === "begin") { if (VERB.test(m[2])) { if (ln.indexOf("\\end{" + m[2] + "}", m.index) < 0) verb = m[2]; } else stack.push([m[2], L]); }
          else if (!VERB.test(m[2])) {
            if (!stack.length) add("error", f, L, "\\end{" + m[2] + "} 앞에 \\begin{" + m[2] + "} 가 없어요");
            else if (stack[stack.length - 1][0] !== m[2]) { const top = stack[stack.length - 1]; add("error", f, L, "\\end{" + m[2] + "} 가 " + top[1] + "줄의 \\begin{" + top[0] + "} 와 짝이 안 맞아요"); const k = stack.map((s) => s[0]).lastIndexOf(m[2]); if (k >= 0) stack.length = k; else stack.pop(); }
            else stack.pop();
          }
        }
        for (let j = 0; j < ln.length; j++) { const c = ln[j]; if (c === "\\") { j++; continue; } if (c === "{") braces.push(L); else if (c === "}") { if (braces.length) braces.pop(); else add("error", f, L, "여는 { 없이 닫는 } 가 있어요"); } }
      });
      stack.forEach((s) => add("error", f, s[1], "\\begin{" + s[0] + "} 를 닫는 \\end{" + s[0] + "} 가 없어요"));
      if (braces.length) add("error", f, braces[braces.length - 1], "닫히지 않은 { 가 있어요");
      // 문단마다 $ 짝
      let para = [], start = 1;
      const flush = () => { const t = para.join("\n").replace(/\\\$/g, "").replace(/\$\$/g, ""); const n = (t.match(/\$/g) || []).length; if (n % 2) add("warning", f, start, "이 문단에 $ 가 홀수 개 — 수식이 안 닫혔을 수 있어요"); para = []; };
      lines.forEach((raw, i) => { const ln = stripComment(raw); if (!ln.trim()) { flush(); start = i + 2; } else { if (!para.length) start = i + 1; para.push(ln); } }); flush();
    });
    if (main && files[main] != null && !/\\end\{document\}/.test(files[main])) add("warning", main, String(files[main]).split("\n").length, "본문에 \\end{document} 가 없어요");
    const labs = labels(files), lk = {}; labs.forEach((l) => { if (lk[l.key]) add("warning", l.file, l.line, "이름표 '" + l.key + "' 가 이미 " + lk[l.key].file + " " + lk[l.key].line + "줄에 있어요"); else lk[l.key] = l; });
    refUses(files).forEach((r) => { if (r.key && !lk[r.key]) add("warning", r.file, r.line, "없는 이름표를 참조해요: " + r.key); });
    const bib = bibAll(files), bk = {}; bib.forEach((b) => { bk[b.key] = b; });
    const usesBib = texs.some((f) => /\\bibliography\{|\\addbibresource\{/.test(files[f])); const hasItems = texs.some((f) => /\\bibitem\{/.test(files[f]));
    if (usesBib || bib.length) { const cu = citeUses(files); Object.keys(cu).forEach((k) => { if (!bk[k] && !hasItems) cu[k].forEach((u) => add("warning", u.file, u.line, "참고문헌(.bib)에 없는 인용: " + k)); }); }
    scanAll(files, /\\(input|include|subfile)\{([^}]+)\}/g, (m, f, l) => { if (!resolveInput(files, m[2], base)) add("error", f, l, "끼워 넣을 파일이 없어요: " + m[2]); });
    scanAll(files, /\\bibliography\{([^}]+)\}/g, (m, f, l) => m[1].split(",").forEach((b) => { b = b.trim(); if (b && !resolveInput(files, b.replace(/\.bib$/, "") + ".bib", base) && files[b + ".bib"] == null && files[b] == null) add("error", f, l, "참고문헌 파일이 없어요: " + b + ".bib"); }));
    const gp = texs.some((f) => /\\graphicspath/.test(files[f]));
    if (!gp && assetNames) { const A = {}; assetNames.forEach((a) => { A[a] = 1; A[a.replace(/\.[^./]+$/, "")] = 1; if (base && a.indexOf(base + "/") === 0) { const r = a.slice(base.length + 1); A[r] = 1; A[r.replace(/\.[^./]+$/, "")] = 1; } }); scanAll(files, /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]+)\}/g, (m, f, l) => { const n = m[1].trim(); if (/^example-image/.test(n) || A[n] || A[n.replace(/^\.\//, "")]) return; add("warning", f, l, "그림 파일을 못 찾았어요: " + n + " (📁 에 올려 주세요)"); }); }
    return out.slice(0, 400);
  }

  /* ------------------------------------------------------------ 단어 세기 */
  function plain(t) {
    return String(t || "").split("\n").map(stripComment).join("\n")
      .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|tikzpicture|axis|lstlisting|verbatim|algorithmic|tabular)\*?\}[\s\S]*?\\end\{\1\*?\}/g, " ")
      .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$]*\$|\\\([\s\S]*?\\\)/g, " ")
      .replace(/\\(cite\w*|ref|eqref|label|includegraphics|input|include|usepackage|documentclass|bibliography\w*|url|href|newcommand|renewcommand|setlength|definecolor|vspace|hspace)\*?(\[[^\]]*\])?\{[^}]*\}/g, " ")
      .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, " ").replace(/[{}&~\\#^_]/g, " ");
  }
  function words(files, main) {
    const ol = outline(files, main); const res = { words: 0, chars: 0, figures: 0, tables: 0, equations: 0, cites: 0, sections: [] };
    const seen = {}; const base = main && main.indexOf("/") > 0 ? main.slice(0, main.lastIndexOf("/")) : "";
    const order = []; (function walk(f, d) { if (!f || seen[f] || d > 8 || files[f] == null) return; seen[f] = 1; order.push(f); String(files[f]).replace(/\\(?:input|include|subfile)\{([^}]+)\}/g, (m, n) => { walk(resolveInput(files, n, base), d + 1); return m; }); })(main, 0);
    order.forEach((f) => {
      let t = String(files[f]); if (f === main) { const i = t.indexOf("\\begin{document}"); if (i >= 0) t = t.slice(i); }
      res.figures += (t.match(/\\begin\{figure\*?\}/g) || []).length; res.tables += (t.match(/\\begin\{table\*?\}/g) || []).length;
      res.equations += (t.match(/\\begin\{(equation|align|gather|multline)\*?\}|\\\[/g) || []).length;
      res.cites += (t.match(/\\cite\w*\{/g) || []).length;
      const p = plain(t); const w = p.split(/\s+/).filter((x) => /[\w가-힣]/.test(x)); res.words += w.length; res.chars += p.replace(/\s+/g, "").length;
    });
    // 절마다
    ol.filter((o) => o.lv <= 2 && o.kind !== "frame").forEach((o, i, arr) => {
      const next = arr[i + 1]; const lines = String(files[o.file]).split("\n"); const end = next && next.file === o.file ? next.line - 1 : lines.length;
      const p = plain(lines.slice(o.line - 1, end).join("\n")); res.sections.push({ title: o.title, lv: o.lv, file: o.file, line: o.line, words: p.split(/\s+/).filter((x) => /[\w가-힣]/.test(x)).length });
    });
    res.minutes = Math.max(1, Math.round(res.words / 230));
    return res;
  }

  /* ------------------------------------------------------------ 비교(줄 단위) */
  function diff(a, b) {
    const A = String(a || "").split("\n"), B = String(b || "").split("\n");
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const a2 = A.slice(s, ea), b2 = B.slice(s, eb), out = [];
    for (let i = 0; i < s; i++) out.push(["=", A[i]]);
    if (a2.length * b2.length > 4e6) { a2.forEach((x) => out.push(["-", x])); b2.forEach((x) => out.push(["+", x])); }
    else {
      const n = a2.length, m = b2.length, T = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = a2[i] === b2[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
      let i = 0, j = 0; while (i < n && j < m) { if (a2[i] === b2[j]) { out.push(["=", a2[i]]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) out.push(["-", a2[i++]]); else out.push(["+", b2[j++]]); }
      while (i < n) out.push(["-", a2[i++]]); while (j < m) out.push(["+", b2[j++]]);
    }
    for (let i = ea; i < A.length; i++) out.push(["=", A[i]]);
    return out;
  }
  function diffStat(d) { let p = 0, m = 0; d.forEach((x) => { if (x[0] === "+") p++; else if (x[0] === "-") m++; }); return { add: p, del: m }; }
  function diffHtml(d, ctx) {   // 바뀐 곳 앞뒤 ctx 줄만
    ctx = ctx == null ? 3 : ctx; const keep = d.map(() => false);
    d.forEach((x, i) => { if (x[0] !== "=") for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true; });
    let html = "", gap = false, la = 0, lb = 0;
    d.forEach((x, i) => { if (x[0] !== "+") la++; if (x[0] !== "-") lb++; if (!keep[i]) { gap = true; return; } if (gap) { html += '<div class="pk-gap">⋯</div>'; gap = false; } html += '<div class="pk-d ' + (x[0] === "+" ? "add" : x[0] === "-" ? "del" : "eq") + '"><span>' + (x[0] === "+" ? "" : la) + "</span><span>" + (x[0] === "-" ? "" : lb) + "</span><i>" + (x[0] === "=" ? " " : x[0]) + "</i><code>" + esc(x[1]) + "</code></div>"; });
    return html || '<p class="sh-muted">바뀐 곳이 없어요.</p>';
  }

  /* ------------------------------------------------------------ 커서 아래 수식 */
  function mathAt(getLine, count, line, ch) {
    const t = getLine(line) || "";
    const segs = []; let i = 0;
    while (i < t.length) {
      const c = t[i];
      if (c === "\\" && (t[i + 1] === "(")) { const e = t.indexOf("\\)", i + 2); if (e < 0) break; segs.push([i, e + 2, t.slice(i + 2, e)]); i = e + 2; continue; }
      if (c === "\\") { i += 2; continue; }
      if (c === "%") break;
      if (c === "$" && t[i + 1] !== "$") { let e = i + 1; while (e < t.length && !(t[e] === "$" && t[e - 1] !== "\\")) e++; if (e >= t.length) break; segs.push([i, e + 1, t.slice(i + 1, e)]); i = e + 1; continue; }
      i++;
    }
    const s = segs.find((g) => ch > g[0] && ch < g[1]); if (s && s[2].trim()) return { src: s[2], display: false, from: line, to: line };
    const OPEN = /\\begin\{(equation|align|gather|multline|eqnarray|displaymath|alignat|flalign)(\*?)\}|\\\[|\$\$/;
    const CLOSE = /\\end\{(equation|align|gather|multline|eqnarray|displaymath|alignat|flalign)(\*?)\}|\\\]|\$\$/;
    for (let a = line; a >= Math.max(0, line - 40); a--) {
      const la = stripComment(getLine(a) || "");
      if (a < line && CLOSE.test(la) && !OPEN.test(la)) return null;
      const m = OPEN.exec(la); if (!m) continue;
      for (let b = a; b < Math.min(count, a + 60); b++) {
        const lb = stripComment(getLine(b) || ""); const from = b === a ? m.index + m[0].length : 0; const cm = CLOSE.exec(lb.slice(from));
        if (cm) {
          if (line > b || (line === b && false)) return null;
          const parts = []; for (let k = a; k <= b; k++) parts.push(stripComment(getLine(k) || ""));
          let src = parts.join("\n"); src = src.slice(src.indexOf(m[0]) + m[0].length); const ci = src.search(CLOSE); if (ci >= 0) src = src.slice(0, ci);
          src = src.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber|\\notag/g, "");
          const env = m[1] || ""; if (/^(align|alignat|flalign|eqnarray)/.test(env)) src = "\\begin{aligned}" + src.replace(/&=/g, "&=") + "\\end{aligned}"; else if (env === "gather") src = "\\begin{gathered}" + src + "\\end{gathered}";
          return src.trim() ? { src: src, display: true, from: a, to: b } : null;
        }
      }
      return null;
    }
    return null;
  }

  /* ------------------------------------------------------------ 오류 설명(한국어) */
  const HINTS = [
    [/Undefined control sequence/i, "정의되지 않은 명령이에요. 철자를 확인하거나, 그 명령을 주는 \\usepackage 를 앞부분에 넣으세요."],
    [/Missing \$ inserted/i, "수식 기호(^ _ \\alpha 같은 것)가 수식 밖에 있어요. $…$ 로 감싸세요. 밑줄 글자는 \\_ 로."],
    [/Missing \} inserted|Extra \}|Too many \}|Missing \{ inserted/i, "중괄호 { } 짝이 안 맞아요. 바로 앞 명령의 괄호를 확인하세요."],
    [/File `?([^'`]+)'? not found/i, "파일을 못 찾았어요. 이름·폴더·확장자를 확인하고, 그림이면 📁 에 올렸는지 보세요."],
    [/Environment (\S+) undefined/i, "모르는 환경이에요. 그 환경을 주는 패키지를 \\usepackage 로 넣거나 이름을 확인하세요."],
    [/\\begin\{[^}]+\} on input line \d+ ended by \\end/i, "\\begin 과 \\end 의 이름이 서로 달라요."],
    [/Misplaced alignment tab character &/i, "& 는 표·align 안에서만 써요. 글자 &는 \\& 로 쓰세요."],
    [/Overfull \\hbox/i, "줄이 오른쪽으로 넘쳤어요. 긴 낱말·주소·표가 원인 — \\url{}, 폭(\\linewidth) 줄이기, \\allowbreak 를 써 보세요."],
    [/Underfull \\hbox|Underfull \\vbox/i, "간격이 헐거워요. 보통은 그냥 둬도 돼요(\\\\ 를 줄 끝에 연달아 쓰면 생겨요)."],
    [/Citation .* undefined|참고문헌에 없는 인용/i, "인용 키가 .bib 에 없어요. 📚 참고문헌에서 키를 확인하거나 추가하세요."],
    [/Reference .* undefined|참조할 이름표|없는 이름표/i, "\\ref 한 이름표가 없어요. \\label{…} 철자를 확인하세요."],
    [/Text line contains an invalid character/i, "보이지 않는 이상한 글자가 들어 있어요. 그 줄을 지우고 다시 쳐 보세요."],
    [/Paragraph ended before/i, "명령의 { } 안에 빈 줄이 있어요. 빈 줄을 지우거나 괄호를 닫으세요."],
    [/Double (superscript|subscript)/i, "x^a^b 처럼 위·아래 첨자가 겹쳤어요. x^{ab} 또는 {x^a}^b 로 쓰세요."],
    [/Missing number/i, "숫자·길이가 와야 할 자리에 없어요(\\vspace{} 등)."],
    [/Illegal unit of measure/i, "길이에 단위가 없어요. 1cm·10pt·0.5\\linewidth 처럼 쓰세요."],
    [/Can be used only in preamble/i, "\\usepackage 같은 명령은 \\begin{document} 앞에서만 쓸 수 있어요."],
    [/Option clash for package/i, "같은 패키지를 다른 옵션으로 두 번 불렀어요. 한 번만, 옵션을 합쳐서 부르세요."],
    [/Float too large|Float\(s\) lost/i, "그림·표가 쪽보다 커요. 폭이나 높이를 줄이세요."],
    [/multiply defined|두 번 이상 정의/i, "같은 이름표가 두 번 있어요. 하나를 바꾸세요."],
    [/already defined/i, "이미 있는 명령 이름이에요. \\renewcommand 를 쓰거나 다른 이름을 고르세요."],
    [/Font .* (not found|cannot be found)/i, "글꼴을 못 찾았어요. 글꼴 이름을 확인하거나 kotex 기본 글꼴을 쓰세요."],
    [/짝이 안 맞아요|닫는|닫히지/i, "괄호·환경의 짝을 맞춰 주세요. 줄을 눌러 그 자리로 가 보세요."],
  ];
  function hint(msg) { const h = HINTS.find((x) => x[0].test(msg || "")); return h ? h[1] : ""; }

  /* ------------------------------------------------------------ 바로 보기(LaTeX → HTML) */
  function mathHtml(src, display) { try { if (window.katex) return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, trust: false }); } catch (e) { /* 계속 */ } return '<code class="pp-m">' + esc(src) + "</code>"; }
  function expandInputs(src, files, base, depth) {
    if ((depth || 0) > 6) return src;
    return src.replace(/\\(input|include|subfile)\{([^}]+)\}/g, (m0, c, n) => { const f = resolveInput(files, n, base); return f ? expandInputs(String(files[f]), files, base, (depth || 0) + 1) : m0; });
  }
  // opt.img(name) → 그림 주소(없으면 null)
  function render(files, main, opt) {
    opt = opt || {}; const base = main && main.indexOf("/") > 0 ? main.slice(0, main.lastIndexOf("/")) : "";
    let src = expandInputs(String(files[main] || ""), files, base);
    src = src.split("\n").map(stripComment).join("\n");
    const pre = src.slice(0, Math.max(0, src.indexOf("\\begin{document}")));
    const meta = {}; ["title", "author", "date", "subtitle", "institute"].forEach((k) => { const i = pre.search(new RegExp("\\\\" + k + "(\\[[^\\]]*\\])?\\{")); if (i >= 0) { const j = pre.indexOf("{", i); const a = argAt(pre, j); if (a) meta[k] = a[0]; } });
    const thms = {}; pre.replace(/\\newtheorem\*?\{([^}]+)\}(?:\[[^\]]*\])?\{([^}]+)\}/g, (m, e, n) => { thms[e] = n; return m; });
    const isBeamer = /\\documentclass(\[[^\]]*\])?\{beamer\}/.test(pre);
    let body = (/\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(src) || [0, src])[1];
    const bib = {}; bibAll(files).forEach((b) => { bib[b.key] = b.f; });
    const labels = {}, cites = [], notes = [], heads = []; let sec = [0, 0, 0, 0], eqN = 0, figN = 0, tabN = 0, thmN = 0;
    const keep = []; const hold = (html) => { keep.push(html); return "\u0000" + (keep.length - 1) + "\u0000"; };
    let h = body;
    // 그대로 찍기·코드·알고리즘
    h = h.replace(/\\begin\{(verbatim|lstlisting|minted)\}(\[[^\]]*\]|\{[^}]*\})*([\s\S]*?)\\end\{\1\}/g, (m0, e, o, inner) => hold('<pre class="pp-pre">' + esc(inner.replace(/^\n/, "")) + "</pre>"));
    h = h.replace(/\\begin\{algorithmic\}(\[[^\]]*\])?([\s\S]*?)\\end\{algorithmic\}/g, (m0, o, inner) => hold('<pre class="pp-pre pp-algo">' + esc(inner.replace(/\\(State|Require|Ensure|Return)\b/g, (x, k) => ({ State: "", Require: "입력:", Ensure: "출력:", Return: "return" })[k]).replace(/\\(For|While|If|ElsIf|Else|EndFor|EndWhile|EndIf)\b/g, (x, k) => k.replace(/^End/, "end ").toLowerCase()).replace(/\$([^$]*)\$/g, "$1").trim()) + "</pre>"));
    h = h.replace(/\\begin\{(tikzpicture|axis)\}([\s\S]*?)\\end\{\1\}/g, () => hold('<div class="pp-ph">✏ TikZ·그래프 — PDF 에서 보세요</div>'));
    // 수식
    h = h.replace(/\\begin\{(equation|align|gather|multline|eqnarray|alignat|flalign)(\*?)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\2\}/g, (m0, env, star, a, inner) => { let lab = ""; inner = inner.replace(/\\label\{([^}]+)\}/g, (x, l) => { lab = lab || l; return ""; }); const n = star ? "" : String(++eqN); if (lab) labels[lab] = n; const tex = env === "equation" ? inner : /gather/.test(env) ? "\\begin{gathered}" + inner + "\\end{gathered}" : "\\begin{aligned}" + inner.replace(/\\nonumber|\\notag/g, "") + "\\end{aligned}"; return hold('<div class="pp-eq">' + mathHtml(tex.trim(), true) + (n ? "<span>(" + n + ")</span>" : "") + "</div>"); });
    h = h.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m0, a, b) => hold('<div class="pp-eq">' + mathHtml((a || b).trim(), true) + "</div>"));
    h = h.replace(/\$([^$]+?)\$|\\\(([\s\S]+?)\\\)/g, (m0, a, b) => hold(mathHtml((a || b).trim(), false)));
    // 표
    h = h.replace(/\\begin\{(table)\*?\}(\[[^\]]*\])?([\s\S]*?)\\end\{table\*?\}/g, (m0, e, o, inner) => {
      let cap = "", lab = ""; inner = inner.replace(/\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/, (x, c) => { cap = c; return ""; }).replace(/\\label\{([^}]+)\}/, (x, l) => { lab = l; return ""; });
      const n = ++tabN; if (lab) labels[lab] = String(n);
      const tb = /\\begin\{(tabular|tabularx|longtable)\*?\}(\{[^}]*\})?(\{(?:[^{}]|\{[^{}]*\})*\})([\s\S]*?)\\end\{\1\*?\}/.exec(inner);
      return hold('<figure class="pp-tab"><figcaption>표 ' + n + ". " + inline(cap) + "</figcaption>" + (tb ? tableHtml(tb[4]) : "") + "</figure>");
    });
    h = h.replace(/\\begin\{(tabular|tabularx)\*?\}(\{[^}]*\})?(\{(?:[^{}]|\{[^{}]*\})*\})([\s\S]*?)\\end\{\1\*?\}/g, (m0, e, w, c, inner) => hold('<figure class="pp-tab">' + tableHtml(inner) + "</figure>"));
    // 그림(하위 그림 포함)
    h = h.replace(/\\begin\{figure\*?\}(\[[^\]]*\])?([\s\S]*?)\\end\{figure\*?\}/g, (m0, o, inner) => {
      const subs = []; inner = inner.replace(/\\begin\{subfigure\}(\[[^\]]*\])?\{[^}]*\}([\s\S]*?)\\end\{subfigure\}/g, (x, oo, s) => { const im = /\\includegraphics\*?(\[[^\]]*\])?\{([^}]+)\}/.exec(s); let c = ""; s.replace(/\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/, (y, cc) => { c = cc; return ""; }); subs.push({ img: im && im[2], cap: c }); return ""; });
      let cap = "", lab = ""; inner.replace(/\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/, (x, c) => { cap = c; return ""; }); inner.replace(/\\label\{([^}]+)\}/, (x, l) => { lab = l; return ""; });
      const n = ++figN; if (lab) labels[lab] = String(n);
      const ims = subs.length ? subs : (() => { const l = []; inner.replace(/\\includegraphics\*?(\[[^\]]*\])?\{([^}]+)\}/g, (x, oo, nm) => { l.push({ img: nm }); return x; }); return l; })();
      return hold('<figure class="pp-fig"><div class="pp-figrow">' + ims.map((s, i) => '<div class="pp-sub">' + imgHtml(s.img) + (s.cap ? "<small>(" + String.fromCharCode(97 + i) + ") " + inline(s.cap) + "</small>" : "") + "</div>").join("") + "</div><figcaption>그림 " + n + ". " + inline(cap) + "</figcaption></figure>");
    });
    // 초록·정리류·증명·인용 단락·가운데
    h = h.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, (m0, a) => '<div class="pp-abs"><b>초록</b>' + a + "</div>");
    Object.keys(thms).forEach((env) => { h = h.replace(new RegExp("\\\\begin\\{" + env.replace(/[*]/g, "\\*") + "\\}(\\[([^\\]]*)\\])?([\\s\\S]*?)\\\\end\\{" + env.replace(/[*]/g, "\\*") + "\\}", "g"), (m0, o, title, inner) => { let lab = ""; inner = inner.replace(/\\label\{([^}]+)\}/, (x, l) => { lab = l; return ""; }); const n = ++thmN; if (lab) labels[lab] = String(n); return '<div class="pp-thm"><b>' + esc(thms[env]) + " " + n + (title ? " (" + inline(title) + ")" : "") + ".</b> " + inner + "</div>"; }); });
    h = h.replace(/\\begin\{proof\}(\[[^\]]*\])?([\s\S]*?)\\end\{proof\}/g, (m0, o, inner) => '<div class="pp-proof"><i>증명.</i> ' + inner + ' <span class="pp-qed">∎</span></div>');
    h = h.replace(/\\begin\{(quote|quotation)\}([\s\S]*?)\\end\{\1\}/g, (m0, e, inner) => "<blockquote>" + inner + "</blockquote>");
    h = h.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (m0, inner) => '<div class="pp-c">' + inner + "</div>");
    h = h.replace(/\\begin\{(block|alertblock|exampleblock)\}\{([^}]*)\}([\s\S]*?)\\end\{\1\}/g, (m0, e, t, inner) => '<div class="pp-block ' + e + '"><b>' + inline(t) + "</b>" + inner + "</div>");
    h = h.replace(/\\begin\{(summary|reviewer|tcolorbox)\}(\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g, (m0, e, t, inner) => '<div class="pp-block">' + (t ? "<b>" + inline(t.slice(1, -1)) + "</b>" : "") + inner + "</div>");
    h = h.replace(/\\begin\{titlepage\}([\s\S]*?)\\end\{titlepage\}/g, (m0, inner) => '<div class="pp-tp">' + inner + "</div>");
    // 목록
    for (let k = 0; k < 4; k++) h = h.replace(/\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?((?:(?!\\begin\{(?:itemize|enumerate|description)\})[\s\S])*?)\\end\{\1\}/g, (m0, env, o, inner) => { const tag = env === "enumerate" ? "ol" : env === "description" ? "dl" : "ul"; return "<" + tag + ">" + inner.split(/\\item\b/).slice(1).map((x) => { const d = /^\s*\[([^\]]*)\]([\s\S]*)$/.exec(x); return env === "description" && d ? "<dt>" + inline(d[1]) + "</dt><dd>" + d[2].trim() + "</dd>" : "<li>" + (d ? "<b>" + inline(d[1]) + "</b> " + d[2] : x).trim() + "</li>"; }).join("") + "</" + tag + ">"; });
    // 슬라이드(beamer)
    if (isBeamer) h = h.replace(/\\begin\{frame\}(?:<[^>]*>)?(\[[^\]]*\])?(\{([^}]*)\})?([\s\S]*?)\\end\{frame\}/g, (m0, o, t, title, inner) => { inner = inner.replace(/\\frametitle\{([^}]*)\}/, (x, ft) => { title = ft; return ""; }); return '<section class="pp-frame">' + (title ? "<h3>" + inline(title) + "</h3>" : "") + '<div class="pp-fb">' + inner + "</div></section>"; });
    h = h.replace(/\\begin\{columns\}(\[[^\]]*\])?([\s\S]*?)\\end\{columns\}/g, (m0, o, inner) => '<div class="pp-cols">' + inner.split(/\\column\{[^}]*\}/).filter((x) => x.trim()).map((x) => "<div>" + x + "</div>").join("") + "</div>");
    // 장·절
    h = h.replace(/\\(chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}(\s*\\label\{([^}]+)\})?/g, (m0, lv, star, sh, t, x, lab) => {
      const d = { chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 }[lv]; let num = "";
      const hasCh = /\\chapter\{/.test(body);
      if (d === 4) return "<p><b>" + inline(t) + "</b> ";
      if (!star) { sec[d]++; for (let j = d + 1; j < 4; j++) sec[j] = 0; num = (hasCh ? sec.slice(0, d + 1) : sec.slice(1, d + 1)).join("."); if (!hasCh && d === 0) num = String(sec[0]); }
      if (lab) labels[lab] = num; heads.push({ d: d, num: num, t: t });
      const tag = "h" + Math.min(6, d + 2); return "<" + tag + ' class="pp-h' + (d === 0 ? " pp-ch" : "") + '">' + (num ? "<span>" + (d === 0 ? "제 " + num + " 장" : num) + "</span> " : "") + inline(t) + "</" + tag + ">";
    });
    h = h.replace(/\\label\{([^}]+)\}/g, "");
    h = h.replace(/\\(maketitle|titlepage)/, '<header class="pp-title"><h1>' + inline(meta.title || "") + "</h1>" + (meta.subtitle ? "<p>" + inline(meta.subtitle) + "</p>" : "") + "<p>" + inline((meta.author || "").replace(/\\and/g, " · ").replace(/\\\\(\[[^\]]*\])?/g, "<br>").replace(/\\thanks\{[^}]*\}/g, "")) + "</p>" + (meta.institute ? "<p><small>" + inline(meta.institute) + "</small></p>" : "") + "<small>" + inline((meta.date || "\\today").replace(/\\today/, new Date().toLocaleDateString("ko-KR"))) + "</small></header>");
    h = h.replace(/\\tableofcontents/, () => hold('<nav class="pp-toc"><b>차례</b>' + "\u0001TOC\u0001" + "</nav>"));
    const hasBib = /\\bibliography\{/.test(h);
    h = h.replace(/\\bibliography\{[^}]*\}|\\bibliographystyle\{[^}]*\}|\\appendix|\\listoffigures|\\listoftables|\\(front|main|back)matter/g, "");
    h = h.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => /^<(h\d|div|ul|ol|dl|figure|header|section|blockquote|nav|pre)|^\u0000/.test(p) ? inline(p) : "<p>" + inline(p) + "</p>").join("\n");
    for (let k = 0; k < 3; k++) h = h.replace(/\u0000(\d+)\u0000/g, (m0, i) => keep[+i]);
    h = h.replace("\u0001TOC\u0001", heads.filter((x) => x.d <= 2).map((x) => '<div class="l' + x.d + '">' + (x.num ? "<span>" + esc(x.num) + "</span> " : "") + inline(x.t) + "</div>").join(""));
    if (hasBib && cites.length) h += '<section class="pp-refs"><h2>참고 문헌</h2><ol>' + cites.map((k) => { const b = bib[k]; return "<li>" + (b ? esc((b.author || "").replace(/ and /g, ", ")) + ". " + esc(b.title || k) + ". <i>" + esc(b.journal || b.booktitle || b.publisher || "") + "</i>" + (b.year ? ", " + esc(b.year) : "") + "." : '<span class="pp-bad">[' + esc(k) + "] .bib 에 없음</span>") + "</li>"; }).join("") + "</ol></section>";
    if (notes.length) h += '<section class="pp-notes"><ol>' + notes.map((n) => "<li>" + n + "</li>").join("") + "</ol></section>";
    return { html: h, beamer: isBeamer };

    function imgHtml(nm) {
      if (!nm) return '<div class="pp-img">🖼 그림</div>';
      if (/^example-image/.test(nm)) return '<div class="pp-img ex">' + esc(nm) + "</div>";
      const u = opt.img ? opt.img(nm) : null; return u ? '<img class="pp-imgf" src="' + esc(u) + '" alt="' + esc(nm) + '">' : '<div class="pp-img">🖼 ' + esc(nm) + "<small>파일 없음</small></div>";
    }
    function tableHtml(inner) {
      const rows = inner.split(/\\\\(?:\[[^\]]*\])?/).map((r) => r.replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfoot|rowcolor\{[^}]*\})|\\cmidrule(\([^)]*\))?\{[^}]*\}/g, "").trim()).filter(Boolean);
      return "<table>" + rows.map((r, i) => "<tr>" + r.split(/(?<!\\)&/).map((c) => { let span = 1; c = c.replace(/\\multicolumn\{(\d+)\}\{[^}]*\}\{((?:[^{}]|\{[^{}]*\})*)\}/, (x, n, t) => { span = +n; return t; }).replace(/\\multirow\{[^}]*\}\{[^}]*\}\{((?:[^{}]|\{[^{}]*\})*)\}/, "$1").replace(/\\cellcolor\{[^}]*\}|\\G\b/g, ""); const tg = i ? "td" : "th"; return "<" + tg + (span > 1 ? ' colspan="' + span + '"' : "") + ">" + inline(c.trim()) + "</" + tg + ">"; }).join("") + "</tr>").join("") + "</table>";
    }
    function inline(t) {
      t = String(t || "");
      t = t.replace(/\\(?:no)?cite[pt]?\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g, (m0, ks) => "[" + ks.split(",").map((k) => { k = k.trim(); let i = cites.indexOf(k); if (i < 0) { cites.push(k); i = cites.length - 1; } return '<a class="pp-cite' + (bib[k] ? "" : " bad") + '" title="' + esc(bib[k] ? bib[k].title : ".bib 에 없음") + '">' + (i + 1) + "</a>"; }).join(", ") + "]");
      t = t.replace(/~?\\(eq|auto|c|C)?ref\{([^}]+)\}/g, (m0, e, l) => " " + (labels[l] != null ? (e === "eq" ? "(" + labels[l] + ")" : labels[l]) : '<span class="pp-bad">??</span>'));
      t = t.replace(/\\footnote\{((?:[^{}]|\{[^{}]*\})*)\}/g, (m0, f) => { notes.push(f); return "<sup>" + notes.length + "</sup>"; });
      t = t.replace(/\\textbf\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<b>$1</b>").replace(/\\(textit|emph)\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<i>$2</i>").replace(/\\underline\{([^}]*)\}/g, "<u>$1</u>").replace(/\\texttt\{([^}]*)\}/g, "<code>$1</code>").replace(/\\textsc\{([^}]*)\}/g, '<span style="font-variant:small-caps">$1</span>')
        .replace(/\\alert\{([^}]*)\}/g, '<b class="pp-alert">$1</b>').replace(/\\textcolor\{([a-zA-Z]+)[^}]*\}\{([^}]*)\}/g, '<span style="color:$1">$2</span>').replace(/\\changed\{([^}]*)\}/g, '<span style="color:blue">$1</span>')
        .replace(/\\url\{([^}]*)\}/g, (m0, u) => /^https?:/.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + "</a>" : esc(u)).replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (m0, u, x) => /^(https?:|mailto:)/.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + x + "</a>" : x);
      t = t.replace(/\\(LaTeX|TeX)\b/g, "$1").replace(/\\today/g, new Date().toLocaleDateString("ko-KR")).replace(/\\(ldots|dots)\b/g, "…").replace(/\\%/g, "%").replace(/\\&/g, "&amp;").replace(/\\_/g, "_").replace(/\\#/g, "#").replace(/\\,/g, " ");
      t = t.replace(/\\(centering|noindent|newpage|clearpage|small|large|Large|LARGE|huge|Huge|normalsize|footnotesize|tiny|bfseries|itshape|hfill|vfill|medskip|bigskip|smallskip|par|onehalfspacing|pause|selectfont)\b/g, "").replace(/\\(vspace|hspace)\*?\{[^}]*\}/g, "").replace(/\\\\(\[[^\]]*\])?/g, "<br>").replace(/~/g, "&nbsp;").replace(/---/g, "—").replace(/--/g, "–");
      t = t.replace(/\\(usepackage|documentclass|addcontentsline|pagenumbering|setlength|definecolor|newcommand|renewcommand|pagestyle|thispagestyle|usetheme|usecolortheme|setbeamertemplate)(\[[^\]]*\])?(\{[^}]*\})+/g, "").replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?\{([^}]*)\}/g, "$2").replace(/\\[a-zA-Z]+\*?/g, "").replace(/[{}]/g, "");
      return t;
    }
  }

  window.PAPERKIT = { CMDS: CMDS, ENVS: ENVS, ENV_ARG: ENV_ARG, PKGS: PKGS, CLASSES: CLASSES, BIBSTYLES: BIBSTYLES, SYMBOLS: SYMBOLS, stripComment: stripComment, argAt: argAt, parseBib: parseBib, bibAll: bibAll, labels: labels, citeUses: citeUses, newcommands: newcommands, outline: outline, lint: lint, words: words, diff: diff, diffStat: diffStat, diffHtml: diffHtml, mathAt: mathAt, hint: hint, render: render, resolveInput: resolveInput, esc: esc };
})();

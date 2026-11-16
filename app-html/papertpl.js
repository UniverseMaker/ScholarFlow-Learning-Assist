(function () {
  "use strict";
  const R = String.raw;

  const BIB = R`@inproceedings{vaswani2017,
  title     = {Attention Is All You Need},
  author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {30},
  pages     = {5998--6008},
  year      = {2017}
}

@inproceedings{he2016,
  title     = {Deep Residual Learning for Image Recognition},
  author    = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},
  booktitle = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition},
  pages     = {770--778},
  year      = {2016}
}

@inproceedings{kipf2017,
  title     = {Semi-Supervised Classification with Graph Convolutional Networks},
  author    = {Kipf, Thomas N. and Welling, Max},
  booktitle = {International Conference on Learning Representations},
  year      = {2017}
}

@inproceedings{devlin2019,
  title     = {{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author    = {Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  booktitle = {Proceedings of NAACL-HLT},
  pages     = {4171--4186},
  year      = {2019}
}

@article{lecun2015,
  title   = {Deep Learning},
  author  = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  volume  = {521},
  number  = {7553},
  pages   = {436--444},
  year    = {2015},
  doi     = {10.1038/nature14539}
}

@inproceedings{goodfellow2014,
  title     = {Generative Adversarial Nets},
  author    = {Goodfellow, Ian and Pouget-Abadie, Jean and Mirza, Mehdi and Xu, Bing and Warde-Farley, David and Ozair, Sherjil and Courville, Aaron and Bengio, Yoshua},
  booktitle = {Advances in Neural Information Processing Systems},
  volume    = {27},
  pages     = {2672--2680},
  year      = {2014}
}
`;

  // 한국어 캡션(kotex 기본은 영어 이름) — 문서 종류별로 쓴다
  const KO_NAMES_ART = R`\renewcommand{\abstractname}{초록}
\renewcommand{\refname}{참고 문헌}
\renewcommand{\figurename}{그림}
\renewcommand{\tablename}{표}
\renewcommand{\contentsname}{차례}`;
  const KO_NAMES_REP = R`\renewcommand{\abstractname}{초록}
\renewcommand{\bibname}{참고 문헌}
\renewcommand{\figurename}{그림}
\renewcommand{\tablename}{표}
\renewcommand{\contentsname}{차례}
\renewcommand{\listfigurename}{그림 차례}
\renewcommand{\listtablename}{표 차례}
\renewcommand{\chaptername}{제}
\renewcommand{\appendixname}{부록}`;

  const list = [];
  const add = (o) => list.push(o);

  /* ------------------------------------------------------------ 1. 한국어 학술 논문 */
  add({
    id: "ko-paper", name: "한국어 학술 논문", cat: "논문", ico: "📄", tags: ["kotex", "절 나누기", "그림·표", "참고문헌"],
    desc: "국내 학술지 투고용 — 절마다 파일을 나누고(sections/), 그림·표·수식·인용이 갖춰진 기본형.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{cite}
\usepackage[hidelinks]{hyperref}
` + KO_NAMES_ART + R`

\title{그래프 신경망 기반 도시 안전 위험 예측\\[4pt]
  \large Urban Safety Risk Prediction with Graph Neural Networks}
\author{홍길동\thanks{교신저자: hong@example.ac.kr} \and 김연구\\[2pt]
  \small 한국연구대학교 전산학부}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
도시 곳곳의 안전 사고는 장소와 시간에 따라 서로 영향을 주고받는다.
이 연구는 도로망을 그래프로 보고, 각 지점의 과거 사고·유동 인구·기상 정보를
그래프 신경망으로 학습해 다음 주의 위험도를 예측한다.
공개 데이터 3년 치로 실험한 결과, 제안 모델은 기준선보다 F1 점수가 4.2\%p 높았다.

\medskip\noindent\textbf{주제어:} 도시 안전, 위험 예측, 그래프 신경망, 시공간 데이터
\end{abstract}

\input{sections/intro}
\input{sections/method}
\input{sections/results}

\section{결론}\label{sec:conclusion}
이 연구는 도시 안전 위험을 그래프 위의 시공간 예측 문제로 정의하고,
그래프 합성곱과 주의 집중(attention)을 결합한 모델을 제안했다.
앞으로는 실시간 센서 자료를 더해 예측 주기를 하루 단위로 줄이려 한다.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
      "sections/intro.tex": R`\section{서론}\label{sec:intro}
도시 안전 사고는 특정 지점에 몰리는 경향이 있고, 가까운 지점끼리 위험이 함께 오르내린다.
기존 연구는 지점을 서로 독립인 시계열로 다뤄 이런 공간적 연결을 놓쳤다.
최근 그래프 신경망~\cite{kipf2017}과 주의 집중 기법~\cite{vaswani2017}은
관계가 있는 자료를 다루는 데 뛰어난 성능을 보였다.

이 논문의 기여는 다음과 같다.
\begin{itemize}
  \item 도로망·행정 구역을 하나의 이질 그래프로 묶는 표현을 제안한다.
  \item 시간 축의 주의 집중으로 계절·요일 효과를 함께 학습한다.
  \item 3년 치 공개 자료로 기준선 대비 성능 향상을 보인다(\ref{sec:exp}절).
\end{itemize}
`,
      "sections/method.tex": R`\section{제안 방법}\label{sec:method}

\subsection{문제 정의}
지점 집합을 꼭짓점 $V$, 인접 관계를 변 $E$로 하는 그래프 $G=(V,E)$에서
시각 $t$의 특징 행렬을 $X_t \in \mathbb{R}^{|V| \times d}$라 하자.
목표는 다음 시각의 위험도 $\hat{y}_{t+1}$을 예측하는 함수 $f$를 배우는 것이다.
\begin{equation}
  \hat{y}_{t+1} = f\left(X_{t-k+1}, \dots, X_t ; G\right)
  \label{eq:task}
\end{equation}

\subsection{모델 구조}
그래프 합성곱 층은 이웃 정보를 다음처럼 모은다.
\begin{equation}
  H^{(l+1)} = \sigma\left(\tilde{D}^{-1/2}\tilde{A}\tilde{D}^{-1/2} H^{(l)} W^{(l)}\right)
  \label{eq:gcn}
\end{equation}
전체 구조는 그림~\ref{fig:arch}와 같다. 손실은 가중 교차 엔트로피를 쓴다.
\begin{align}
  \mathcal{L} &= -\frac{1}{N}\sum_{i=1}^{N} \left[ w\, y_i \log \hat{y}_i + (1-y_i) \log (1-\hat{y}_i) \right]
\end{align}

\begin{figure}[t]
  \centering
  \includegraphics[width=0.75\linewidth]{example-image-a}
  \caption{제안 모델의 전체 구조. 그래프 합성곱 층 뒤에 시간 주의 집중 층이 온다.}
  \label{fig:arch}
\end{figure}
`,
      "sections/results.tex": R`\section{실험}\label{sec:exp}

\subsection{실험 설정}
자료는 2021--2023년 공개 사고 기록과 유동 인구 통계다. 앞의 2년으로 학습하고 마지막 1년으로 평가했다.

\subsection{결과}
표~\ref{tab:main}은 주요 결과다. 제안 모델이 모든 지표에서 가장 좋았다.

\begin{table}[t]
  \centering
  \caption{위험 지점 예측 성능 비교}
  \label{tab:main}
  \begin{tabular}{lccc}
    \toprule
    방법 & 정밀도 & 재현율 & F1 \\
    \midrule
    로지스틱 회귀 & 0.62 & 0.55 & 0.58 \\
    LSTM          & 0.68 & 0.63 & 0.65 \\
    GCN~\cite{kipf2017} & 0.71 & 0.66 & 0.68 \\
    \textbf{제안 모델} & \textbf{0.74} & \textbf{0.71} & \textbf{0.72} \\
    \bottomrule
  \end{tabular}
\end{table}
`,
      "refs.bib": BIB,
    },
  });

  /* ------------------------------------------------------------ 2. 영문 학술 논문 */
  add({
    id: "en-paper", name: "영문 학술 논문 (저자-연도 인용)", cat: "논문", ico: "📝", tags: ["natbib", "author-year", "English"],
    desc: "국제 학술지·워크숍용 영문 원고. \\citet·\\citep 저자-연도 인용과 부록까지.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[round,authoryear]{natbib}
\usepackage[hidelinks]{hyperref}

\title{Learning Spatio-Temporal Risk on Urban Graphs}
\author{Gil-dong Hong\\ KRU \and Yeon-gu Kim\\ KRU}
\date{}

\begin{document}
\maketitle

\begin{abstract}
Urban incidents cluster in space and time. We cast risk forecasting as node-level prediction on a heterogeneous road graph and combine graph convolutions with temporal attention.
On three years of public records our model improves F1 by 4.2 points over strong baselines.
\end{abstract}

\section{Introduction}
Deep learning \citep{lecun2015} has reshaped forecasting. \citet{kipf2017} introduced graph convolutional networks, and attention \citep{vaswani2017} lets models weigh distant time steps.
We bring both ideas to urban safety.

\section{Method}
Given a graph $G=(V,E)$ and features $X_t$, we learn
\begin{equation}
  \hat{y}_{t+1} = f_\theta(X_{t-k+1:t}, G).
\end{equation}

\section{Experiments}
\begin{table}[h]
  \centering
  \caption{Main results.}
  \begin{tabular}{lcc}
    \toprule
    Model & F1 & AUROC \\
    \midrule
    LSTM & 0.65 & 0.81 \\
    GCN  & 0.68 & 0.84 \\
    Ours & \textbf{0.72} & \textbf{0.87} \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Conclusion}
Graph structure matters for urban risk. Code and data will be released.

\bibliographystyle{plainnat}
\bibliography{refs}

\appendix
\section{Hyper-parameters}
We use two graph layers of width 64 and train for 100 epochs with Adam.
\end{document}
`,
      "refs.bib": BIB,
    },
  });

  /* ------------------------------------------------------------ 3. IEEE 학회 */
  add({
    id: "ieee", name: "IEEE 학회 논문 (2단)", cat: "논문", ico: "🏛", tags: ["IEEEtran", "2단", "conference"],
    desc: "IEEE 학회 양식(IEEEtran conference). 저자 블록·키워드·2단 그림·IEEE 인용 양식.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{cite}

\begin{document}

\title{Graph-Based Urban Risk Forecasting\\ with Temporal Attention}

\author{\IEEEauthorblockN{Gil-dong Hong}
\IEEEauthorblockA{\textit{School of Computing} \\
\textit{KRU}\\
Seoul, Korea \\
hong@example.ac.kr}
\and
\IEEEauthorblockN{Yeon-gu Kim}
\IEEEauthorblockA{\textit{School of Computing} \\
\textit{KRU}\\
Seoul, Korea \\
kim@example.ac.kr}
}

\maketitle

\begin{abstract}
We forecast urban incident risk on a road graph by combining graph convolution \cite{kipf2017} with temporal attention \cite{vaswani2017}. Experiments on three years of public data show consistent gains.
\end{abstract}

\begin{IEEEkeywords}
graph neural network, urban safety, forecasting, attention
\end{IEEEkeywords}

\section{Introduction}
Residual networks \cite{he2016} and attention made deep models practical at scale. Urban risk, however, lives on graphs.

\section{Method}
Each layer aggregates neighbors:
\begin{equation}
H^{(l+1)} = \sigma\!\left(\hat{A} H^{(l)} W^{(l)}\right).
\end{equation}

\begin{figure}[t]
\centerline{\includegraphics[width=\columnwidth]{example-image-b}}
\caption{Model overview.}
\label{fig:overview}
\end{figure}

\section{Results}
Fig.~\ref{fig:overview} shows the pipeline; Table~\ref{tab:res} lists results.

\begin{table}[t]
\caption{F1 score by model}
\label{tab:res}
\centering
\begin{tabular}{lc}
\toprule
Model & F1 \\
\midrule
LSTM & 0.65 \\
GCN & 0.68 \\
Ours & \textbf{0.72} \\
\bottomrule
\end{tabular}
\end{table}

\section{Conclusion}
Graph structure and temporal attention are complementary.

\bibliographystyle{IEEEtran}
\bibliography{refs}

\end{document}
`,
      "refs.bib": BIB,
    },
  });

  /* ------------------------------------------------------------ 4. Elsevier 저널 */
  add({
    id: "elsevier", name: "저널 투고 (Elsevier)", cat: "논문", ico: "📰", tags: ["elsarticle", "frontmatter", "keywords"],
    desc: "Elsevier 저널 투고 양식(elsarticle preprint). 소속·교신저자·키워드·번호 인용.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[preprint,12pt]{elsarticle}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}

\journal{Expert Systems with Applications}

\begin{document}

\begin{frontmatter}

\title{Spatio-Temporal Graph Learning for Urban Safety Risk}

\author[kru]{Gil-dong Hong\corref{cor1}}
\ead{hong@example.ac.kr}
\author[kru]{Yeon-gu Kim}
\cortext[cor1]{Corresponding author.}
\address[kru]{School of Computing, KRU, Seoul 00000, Republic of Korea}

\begin{abstract}
We propose a spatio-temporal graph model for urban incident risk. The model couples graph convolution with attention over time and outperforms sequence-only baselines on three years of public data.
\end{abstract}

\begin{keyword}
Graph neural network \sep Urban safety \sep Risk forecasting \sep Attention
\end{keyword}

\end{frontmatter}

\section{Introduction}
\label{sec:intro}
Deep learning \cite{lecun2015} and graph networks \cite{kipf2017} enable relational forecasting.

\section{Method}
\label{sec:method}
Let $G=(V,E)$ be the road graph. We minimize
\begin{equation}
\mathcal{L}(\theta) = \frac{1}{|V|}\sum_{v \in V} \ell\big(y_v, f_\theta(X, G)_v\big).
\end{equation}

\section{Results}
\label{sec:results}
Our model reaches an F1 of 0.72, compared with 0.68 for a plain GCN.

\section{Conclusion}
\label{sec:conclusion}
Spatial structure is essential for urban risk.

\bibliographystyle{elsarticle-num}
\bibliography{refs}

\end{document}
`,
      "refs.bib": BIB,
    },
  });

  /* ------------------------------------------------------------ 5. 학위 논문 */
  add({
    id: "thesis", name: "학위 논문 (석·박사)", cat: "학위·보고서", ico: "🎓", tags: ["report", "장 나누기", "차례·그림 차례", "부록"],
    desc: "장마다 파일(chapters/), 앞부분(front/: 표지·초록·감사의 글), 차례·그림/표 차례·부록·참고 문헌이 갖춰진 학위 논문 틀.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper,oneside]{report}
\usepackage{kotex}
\usepackage[top=30mm,bottom=30mm,left=30mm,right=25mm]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{setspace}
\usepackage[hidelinks]{hyperref}
` + KO_NAMES_REP + R`
\onehalfspacing

\newtheorem{definition}{정의}[chapter]

\begin{document}
\input{front/title}

\pagenumbering{roman}
\input{front/abstract}
\tableofcontents
\listoffigures
\listoftables
\clearpage
\pagenumbering{arabic}

\input{chapters/01-intro}
\input{chapters/02-related}
\input{chapters/03-method}
\input{chapters/04-experiments}
\input{chapters/05-conclusion}

\appendix
\input{chapters/appendix}

\bibliographystyle{plain}
\bibliography{refs}

\input{front/ack}
\end{document}
`,
      "front/title.tex": R`\begin{titlepage}
  \centering
  \vspace*{20mm}
  {\large 공학박사 학위논문\par}
  \vspace{25mm}
  {\LARGE\bfseries 시공간 그래프 학습을 이용한\\[6pt] 도시 안전 위험 예측\par}
  \vspace{8mm}
  {\large Urban Safety Risk Prediction via Spatio-Temporal Graph Learning\par}
  \vfill
  {\large 2026년 12월\par}
  \vspace{10mm}
  {\large 한국연구대학교\par 전산학부\par}
  \vspace{10mm}
  {\Large 홍 길 동\par}
  \vspace{20mm}
\end{titlepage}
`,
      "front/abstract.tex": R`\chapter*{초록}
\addcontentsline{toc}{chapter}{초록}
도시 안전 사고는 공간과 시간에 걸쳐 서로 얽혀 있다. 이 논문은 도시를 그래프로 표현하고,
그래프 신경망과 시간 주의 집중을 결합해 지점별 위험도를 예측하는 방법을 제안한다. \dots

\vspace{1em}\noindent\textbf{핵심어:} 그래프 신경망, 도시 안전, 시공간 예측

\chapter*{Abstract}
\addcontentsline{toc}{chapter}{Abstract}
Urban incidents are entangled in space and time. This thesis represents a city as a graph and \dots

\vspace{1em}\noindent\textbf{Keywords:} graph neural network, urban safety, spatio-temporal forecasting
`,
      "front/ack.tex": R`\chapter*{감사의 글}
\addcontentsline{toc}{chapter}{감사의 글}
이 논문이 나오기까지 이끌어 주신 지도교수님과 연구실 동료들께 깊이 감사드린다.
`,
      "chapters/01-intro.tex": R`\chapter{서론}\label{ch:intro}
\section{연구 배경}
도시화가 빨라지면서 안전 사고의 양상도 복잡해졌다.

\section{연구 목표와 기여}
\begin{enumerate}
  \item 도시를 이질 그래프로 표현하는 방법
  \item 시공간 위험 예측 모델
  \item 대규모 실증 평가
\end{enumerate}

\section{논문 구성}
\ref{ch:related}장은 관련 연구, \ref{ch:method}장은 제안 방법, \ref{ch:exp}장은 실험이다.
`,
      "chapters/02-related.tex": R`\chapter{관련 연구}\label{ch:related}
\section{그래프 신경망}
그래프 합성곱 신경망~\cite{kipf2017}은 이웃의 특징을 모아 꼭짓점 표현을 만든다.
\section{주의 집중}
트랜스포머~\cite{vaswani2017}는 순환 없이 주의 집중만으로 순서를 다룬다.
`,
      "chapters/03-method.tex": R`\chapter{제안 방법}\label{ch:method}
\section{문제 정의}
\begin{definition}
도시 그래프는 $G=(V,E,X)$이며, $X \in \mathbb{R}^{|V|\times d}$는 꼭짓점 특징이다.
\end{definition}
\section{모델}
\begin{equation}
  H^{(l+1)} = \sigma\left(\hat{A}H^{(l)}W^{(l)}\right)
\end{equation}
\begin{figure}[htb]
  \centering
  \includegraphics[width=0.7\linewidth]{example-image-c}
  \caption{제안 모델 구조}\label{fig:model}
\end{figure}
`,
      "chapters/04-experiments.tex": R`\chapter{실험}\label{ch:exp}
\section{자료와 설정}
3년 치 공개 자료를 썼다.
\section{결과}
\begin{table}[htb]
  \centering
  \caption{모델별 성능}\label{tab:thesis-main}
  \begin{tabular}{lcc}
    \toprule
    모델 & F1 & AUROC \\
    \midrule
    LSTM & 0.65 & 0.81 \\
    GCN & 0.68 & 0.84 \\
    제안 & \textbf{0.72} & \textbf{0.87} \\
    \bottomrule
  \end{tabular}
\end{table}
`,
      "chapters/05-conclusion.tex": R`\chapter{결론}\label{ch:conclusion}
이 논문은 도시 안전 위험을 시공간 그래프 학습으로 예측하는 방법을 제안했다.
\section{한계와 향후 연구}
실시간 자료 연계가 남은 과제다.
`,
      "chapters/appendix.tex": R`\chapter{추가 실험 결과}
\section{하이퍼파라미터}
학습률 $10^{-3}$, 배치 64, 에폭 100으로 학습했다.
`,
      "refs.bib": BIB,
    },
  });

  /* ------------------------------------------------------------ 6. 연구개발 계획서 */
  add({
    id: "proposal", name: "연구개발 계획서·제안서", cat: "학위·보고서", ico: "🗂", tags: ["추진 일정(간트)", "예산표", "성과 지표"],
    desc: "과제 제안서 틀 — 개요표, 목표·내용, 연차별 추진 일정(간트 표), 성과 지표, 예산, 기대 효과.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage[table]{xcolor}
\usepackage{kotex}
\usepackage[margin=22mm]{geometry}
\usepackage{booktabs}
\usepackage{array}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
` + KO_NAMES_ART + R`
\definecolor{accent}{HTML}{1D4ED8}
\newcommand{\G}{\cellcolor{accent!55}}
\setlist{nosep}

\begin{document}
\begin{center}
  {\LARGE\bfseries 도시 안전 AI 파운데이션 모델 구축\par}
  \vspace{4pt}{\large 연구개발 계획서\par}
\end{center}

\section*{과제 개요}
\begin{tabular}{>{\bfseries}p{3.2cm}p{12.5cm}}
\toprule
과제명 & 도시 안전 AI 파운데이션 모델 구축 \\
연구 기간 & 2027.~1.~1. -- 2029.~12.~31. (3년) \\
총 연구비 & 15억 원 (정부 출연금 12억, 민간 3억) \\
주관 기관 & 한국연구대학교 \\
\bottomrule
\end{tabular}

\section{연구 목표}
\begin{itemize}
  \item 최종 목표: 도시 안전 다중 과업을 하나의 모델로 처리하는 파운데이션 모델
  \item 정량 목표: 위험 예측 F1 0.80 이상, 추론 지연 200\,ms 이하
\end{itemize}

\section{연구 내용 및 방법}
\subsection{1차년도: 데이터 구축}
공공 데이터 10종을 통합하고 표준 스키마를 만든다.
\subsection{2차년도: 모델 개발}
시공간 그래프 사전학습과 과업별 미세조정을 수행한다.
\subsection{3차년도: 실증}
2개 지자체에서 현장 실증을 수행한다.

\section{추진 일정}
\begin{center}
\small
\begin{tabular}{l*{12}{|c}}
\toprule
세부 과제 & 1 & 2 & 3 & 4 & 5 & 6 & 7 & 8 & 9 & 10 & 11 & 12 \\
\midrule
자료 수집·정제 & \G & \G & \G & \G &  &  &  &  &  &  &  &  \\
표준 스키마 &  &  & \G & \G & \G &  &  &  &  &  &  &  \\
기준 모델 &  &  &  &  & \G & \G & \G & \G &  &  &  &  \\
평가·보고 &  &  &  &  &  &  &  &  & \G & \G & \G & \G \\
\bottomrule
\end{tabular}
\end{center}

\section{성과 지표}
\begin{tabular}{lccc}
\toprule
지표 & 1차년도 & 2차년도 & 3차년도 \\
\midrule
SCI 논문 (편) & 1 & 2 & 3 \\
특허 출원 (건) & 0 & 1 & 2 \\
기술 이전 (건) & 0 & 0 & 1 \\
\bottomrule
\end{tabular}

\section{연구비 편성 (1차년도, 백만 원)}
\begin{tabular}{lrr}
\toprule
비목 & 금액 & 비율 \\
\midrule
인건비 & 200 & 40\% \\
연구 장비·재료비 & 150 & 30\% \\
연구 활동비 & 100 & 20\% \\
간접비 & 50 & 10\% \\
\midrule
합계 & 500 & 100\% \\
\bottomrule
\end{tabular}

\section{기대 효과}
\begin{enumerate}
  \item 지자체 안전 정책의 근거 기반 의사결정
  \item 도시 안전 데이터 표준화
\end{enumerate}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 7. 연구 결과 보고서 */
  add({
    id: "report", name: "연구 결과 보고서", cat: "학위·보고서", ico: "📊", tags: ["표지", "요약 상자", "차례", "결과 표"],
    desc: "표지·요약 상자·차례·장별 결과·참고 문헌이 들어간 보고서. 상자(tcolorbox)로 핵심을 강조.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{report}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{tcolorbox}
\usepackage[hidelinks]{hyperref}
` + KO_NAMES_REP + R`
\definecolor{accent}{HTML}{0F766E}
\newtcolorbox{summary}[1][]{colback=accent!6,colframe=accent,boxrule=0.6pt,arc=3pt,title=#1}

\begin{document}
\begin{titlepage}
  \centering
  \vspace*{40mm}
  {\Huge\bfseries 도시 안전 데이터 분석\par}
  \vspace{6mm}
  {\Large 2026년도 연구 결과 보고서\par}
  \vfill
  {\large 한국연구대학교 데이터과학연구실\par}
  {\large \today\par}
\end{titlepage}

\begin{summary}[요약]
\begin{itemize}
  \item 3년 치 사고 자료 12만 건을 분석해 고위험 지점 214곳을 찾았다.
  \item 예측 모델의 F1은 0.72로 기존 방식보다 0.07 높았다.
  \item 야간 보행자 사고가 전체의 38\%로 가장 큰 비중을 차지했다.
\end{itemize}
\end{summary}

\tableofcontents

\chapter{분석 개요}
\section{목적}
이 보고서는 2026년 도시 안전 데이터 분석 결과를 정리한다.
\section{자료}
공공 데이터 포털의 사고 기록과 유동 인구 자료를 썼다.

\chapter{분석 결과}
\section{시간대별 분포}
\begin{figure}[htb]
  \centering
  \includegraphics[width=0.65\linewidth]{example-image-golden}
  \caption{시간대별 사고 건수}
\end{figure}
\section{유형별 비중}
\begin{table}[htb]
  \centering
  \caption{사고 유형별 건수}
  \begin{tabular}{lrr}
    \toprule
    유형 & 건수 & 비중 \\
    \midrule
    보행자 & 45{,}600 & 38\% \\
    차량 간 & 39{,}100 & 33\% \\
    단독 & 21{,}300 & 18\% \\
    기타 & 13{,}000 & 11\% \\
    \bottomrule
  \end{tabular}
\end{table}

\chapter{결론 및 제언}
\begin{summary}[제언]
야간 보행자 사고 다발 지점 30곳에 조명·횡단 시설을 우선 보강할 것을 권한다.
\end{summary}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 8. 발표 슬라이드 */
  add({
    id: "beamer", name: "발표 슬라이드 (Beamer)", cat: "발표·포스터", ico: "🎤", tags: ["beamer", "16:9", "블록·단", "단계별 등장"],
    desc: "16:9 학회·세미나 발표 — 표지, 차례, 블록, 두 단, 수식, 그림·표, 단계별 등장, 마무리 쪽.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[aspectratio=169,11pt]{beamer}
\usepackage{kotex}
\usepackage{booktabs}
\usetheme{Madrid}
\usecolortheme{default}
\setbeamertemplate{navigation symbols}{}

\title[도시 위험 예측]{그래프 신경망 기반 도시 안전 위험 예측}
\subtitle{2026 추계 학술대회}
\author[홍길동]{홍길동 \and 김연구}
\institute[KRU]{한국연구대학교 전산학부}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{차례}
  \tableofcontents
\end{frame}

\section{배경}
\begin{frame}{연구 배경}
  \begin{itemize}
    \item<1-> 도시 사고는 장소·시간에 몰린다
    \item<2-> 기존 방법은 지점을 서로 독립으로 본다
    \item<3-> \alert{공간 관계를 함께 배우면 더 잘 맞힐 수 있다}
  \end{itemize}
\end{frame}

\begin{frame}{핵심 질문}
  \begin{block}{질문}
    이웃 지점의 위험 정보를 쓰면 예측이 얼마나 좋아지는가?
  \end{block}
  \begin{alertblock}{어려움}
    지점마다 자료의 양과 질이 크게 다르다.
  \end{alertblock}
  \begin{exampleblock}{아이디어}
    도로망 그래프 위에서 이웃 정보를 모은다.
  \end{exampleblock}
\end{frame}

\section{방법}
\begin{frame}{제안 모델}
  \begin{columns}[T]
    \column{0.48\textwidth}
      그래프 합성곱:
      \[ H^{(l+1)} = \sigma\big(\hat{A} H^{(l)} W^{(l)}\big) \]
      시간 주의 집중으로 지난 $k$주를 묶는다.
    \column{0.48\textwidth}
      \includegraphics[width=\linewidth]{example-image-a}
  \end{columns}
\end{frame}

\section{결과}
\begin{frame}{주요 결과}
  \centering
  \begin{tabular}{lcc}
    \toprule
    모델 & F1 & AUROC \\
    \midrule
    LSTM & 0.65 & 0.81 \\
    GCN & 0.68 & 0.84 \\
    \textbf{제안} & \textbf{0.72} & \textbf{0.87} \\
    \bottomrule
  \end{tabular}
  \vspace{1em}

  F1 \alert{+4.2\%p} 향상
\end{frame}

\begin{frame}
  \centering\Huge 감사합니다\\[1em]
  \normalsize 질문 · hong@example.ac.kr
\end{frame}

\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 9. 학회 포스터 */
  add({
    id: "poster", name: "학회 포스터 (A0)", cat: "발표·포스터", ico: "🪧", tags: ["tikzposter", "A0 세로", "블록"],
    desc: "A0 세로 학회 포스터(tikzposter) — 두 단 블록, 수식, 그림, 결론 강조.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[25pt,a0paper,portrait]{tikzposter}
\usepackage{kotex}
\usepackage{booktabs}

\title{그래프 신경망 기반 도시 안전 위험 예측}
\author{홍길동, 김연구}
\institute{한국연구대학교 전산학부}
\usetheme{Default}
\usecolorstyle{Denmark}
\renewcommand{\figurename}{그림}

\begin{document}
\maketitle

\begin{columns}
  \column{0.5}
  \block{연구 배경}{
    도시 안전 사고는 장소와 시간에 몰린다. 가까운 지점끼리 위험이 함께 오르내리지만,
    기존 예측 방법은 지점을 서로 독립인 시계열로 다뤄 이 연결을 놓쳤다.
    이 연구는 도로망을 그래프로 보고 이웃 지점의 정보를 함께 학습한다.
  }
  \block{핵심 기여}{
    \begin{itemize}
      \item 도로망·행정 구역을 하나로 묶은 이질 그래프 표현
      \item 그래프 합성곱 + 시간 주의 집중 결합 모델
      \item 3년 치 공개 자료로 기준선 대비 F1 +4.2\%p
    \end{itemize}
  }
  \block{제안 방법}{
    그래프 합성곱 층은 이웃의 특징을 모은다.
    \[ H^{(l+1)} = \sigma\left(\hat{A} H^{(l)} W^{(l)}\right) \]
    시간 축은 지난 $k$주의 표현에 주의 집중을 건다.
    \[ \alpha_{t} = \mathrm{softmax}\left(\frac{q^\top k_t}{\sqrt{d}}\right) \]
    \begin{tikzfigure}[모델 구조]
      \includegraphics[width=0.85\linewidth]{example-image-a}
    \end{tikzfigure}
  }

  \column{0.5}
  \block{자료}{
    \begin{center}
    \begin{tabular}{lrr}
      \toprule
      자료 & 기간 & 건수 \\
      \midrule
      사고 기록 & 2021--2023 & 120{,}000 \\
      유동 인구 & 2021--2023 & 2{,}300{,}000 \\
      기상 & 2021--2023 & 26{,}000 \\
      \bottomrule
    \end{tabular}
    \end{center}
  }
  \block{실험 결과}{
    \begin{center}
    \begin{tabular}{lcc}
      \toprule
      모델 & F1 & AUROC \\
      \midrule
      LSTM & 0.65 & 0.81 \\
      GCN & 0.68 & 0.84 \\
      제안 & \textbf{0.72} & \textbf{0.87} \\
      \bottomrule
    \end{tabular}
    \end{center}
    \begin{tikzfigure}[지점별 위험도 예시]
      \includegraphics[width=0.8\linewidth]{example-image-b}
    \end{tikzfigure}
  }
  \block{결론}{
    공간 구조를 쓰면 위험 예측이 크게 좋아진다. 다음 단계는 실시간 센서 자료 연계와
    지자체 현장 실증이다.
  }
  \block{참고 문헌}{
    \small [1] T. N. Kipf, M. Welling. Semi-Supervised Classification with Graph Convolutional Networks. ICLR, 2017.\par
    [2] A. Vaswani et al. Attention Is All You Need. NeurIPS, 2017.
  }
\end{columns}

\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 10. 심사 답변서 */
  add({
    id: "rebuttal", name: "심사 답변서 (Response Letter)", cat: "투고·서신", ico: "💬", tags: ["심사 의견 상자", "수정 표시", "tcolorbox"],
    desc: "심사위원 의견을 상자로, 답변과 고친 문장(파란색)을 짝지어 쓰는 수정 답변서.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=22mm]{geometry}
\usepackage{xcolor}
\usepackage{tcolorbox}
\usepackage{enumitem}

\newtcolorbox{reviewer}{colback=gray!7,colframe=gray!55,boxrule=0.4pt,arc=2pt,left=6pt,right=6pt,top=4pt,bottom=4pt}
\newcommand{\response}{\par\noindent\textbf{답변.}~}
\newcommand{\changed}[1]{\textcolor{blue}{#1}}
\setlength{\parskip}{6pt}
\setlength{\parindent}{0pt}

\begin{document}
\begin{center}
  {\Large\bfseries 심사 의견에 대한 답변서}\\[4pt]
  논문 번호: UR-2026-0123 \quad 제목: 그래프 신경망 기반 도시 안전 위험 예측
\end{center}

심사위원님들의 귀중한 의견에 감사드립니다. 지적해 주신 사항을 모두 반영했으며,
본문에서 고친 부분은 \changed{파란색}으로 표시했습니다.

\section*{심사위원 1}

\begin{reviewer}
\textbf{의견 1.1}\quad 기준선 모델이 너무 약합니다. 최신 시공간 그래프 모델과 비교해 주십시오.
\end{reviewer}
\response 좋은 지적입니다. 최신 모델 두 가지를 기준선에 추가했습니다(표 2).
\changed{제안 모델은 두 모델보다 F1이 각각 0.03, 0.02 높았다.}

\begin{reviewer}
\textbf{의견 1.2}\quad 데이터 전처리 과정이 불명확합니다.
\end{reviewer}
\response 3.1절에 전처리 단계를 순서대로 추가했습니다.

\section*{심사위원 2}

\begin{reviewer}
\textbf{의견 2.1}\quad 실제 정책 활용 사례가 있으면 좋겠습니다.
\end{reviewer}
\response 5절에 지자체 시범 적용 결과를 새로 넣었습니다.

\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 11. 커버레터 */
  add({
    id: "cover", name: "투고 커버레터 (영문)", cat: "투고·서신", ico: "✉", tags: ["cover letter", "편지"],
    desc: "학술지 편집장에게 보내는 투고 편지 — 기여 요약, 적합성, 이해 상충·추천 심사위원.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage[margin=25mm]{geometry}
\usepackage[hidelinks]{hyperref}
\setlength{\parindent}{0pt}
\setlength{\parskip}{8pt}
\pagestyle{empty}

\begin{document}
\begin{flushright}
Gil-dong Hong\\
School of Computing, KRU\\
Seoul 00000, Republic of Korea\\
\href{mailto:hong@example.ac.kr}{hong@example.ac.kr}\\[6pt]
\today
\end{flushright}

Dear Editor,

We are pleased to submit our manuscript entitled \emph{Spatio-Temporal Graph Learning for Urban Safety Risk} for consideration as a research article in \emph{Expert Systems with Applications}.

Urban incidents cluster in space and time, yet most forecasting systems treat locations independently. Our work makes three contributions:
\begin{enumerate}
  \item a heterogeneous road-graph representation of cities,
  \item a forecasting model that combines graph convolution with temporal attention, and
  \item a three-year evaluation showing a 4.2-point F1 improvement.
\end{enumerate}

We believe the manuscript fits the journal's focus on intelligent decision support. It has not been published and is not under consideration elsewhere. All authors approved the submission and declare no competing interests.

Suggested reviewers: Dr.~A (University X, a@x.edu); Dr.~B (Institute Y, b@y.org).

Sincerely,

Gil-dong Hong, on behalf of all authors
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 12. 이력서 */
  add({
    id: "cv", name: "연구자 이력서 (CV)", cat: "투고·서신", ico: "👤", tags: ["색 제목", "학력·경력", "논문 목록"],
    desc: "연구자용 한 장 이력서 — 색 머리줄, 학력·경력·논문·수상·기술. titlesec·enumitem.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[10pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=16mm]{geometry}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\definecolor{accent}{HTML}{2563EB}
\titleformat{\section}{\large\bfseries\color{accent}}{}{0pt}{}[{\color{accent!40}\titlerule}]
\titlespacing*{\section}{0pt}{10pt}{6pt}
\setlist{leftmargin=*,nosep}
\pagestyle{empty}
\newcommand{\entry}[3]{\noindent\textbf{#2}\hfill{\small\color{gray}#1}\\ #3\par\smallskip}

\begin{document}
{\fontsize{24}{28}\selectfont\bfseries 홍길동}\hfill
\begin{tabular}[b]{@{}r@{}}
\href{mailto:hong@example.ac.kr}{hong@example.ac.kr}\\ 010-0000-0000 \\ \href{https://example.org}{example.org}
\end{tabular}\\[2pt]
{\color{gray}선임연구원 · 도시 안전 AI · 시공간 그래프 학습}

\section{학력}
\entry{2020 -- 2025}{공학박사, 전산학 · 한국연구대학교}{학위논문: 시공간 그래프 학습을 이용한 도시 안전 위험 예측}
\entry{2014 -- 2020}{학사, 컴퓨터공학 · 한국대학교}{수석 졸업}

\section{경력}
\entry{2025 -- 현재}{선임연구원 · 데이터과학연구실}{지자체 위험 예측 플랫폼 개발 총괄}

\section{대표 논문}
\begin{enumerate}
  \item \textbf{G. Hong}, Y. Kim. Spatio-Temporal Graph Learning for Urban Safety Risk. \emph{Expert Systems with Applications}, 2026.
  \item \textbf{G. Hong} et al. Graph-Based Urban Risk Forecasting. \emph{IEEE BigData}, 2025.
\end{enumerate}

\section{수상}
\begin{itemize}
  \item 2025 우수 박사학위논문상
\end{itemize}

\section{기술}
Python, PyTorch, PyG, PostgreSQL/PostGIS, \LaTeX
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 13. 수학 노트 */
  add({
    id: "math", name: "수학·이론 노트 (정리·증명)", cat: "노트·예제", ico: "∑", tags: ["amsthm", "정리·증명", "사용자 명령"],
    desc: "정의·정리·보조정리·증명 환경과 자주 쓰는 수학 명령(\\R, \\norm, \\argmin)이 준비된 노트.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{mathtools}
` + KO_NAMES_ART + R`
\theoremstyle{plain}
\newtheorem{theorem}{정리}[section]
\newtheorem{lemma}[theorem]{보조정리}
\newtheorem{corollary}[theorem]{따름정리}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{정의}
\newtheorem{example}[theorem]{예}
\theoremstyle{remark}
\newtheorem*{remark}{참고}
\renewcommand{\proofname}{증명}

\newcommand{\R}{\mathbb{R}}
\newcommand{\E}{\mathbb{E}}
\newcommand{\norm}[1]{\left\lVert #1 \right\rVert}
\DeclareMathOperator*{\argmin}{arg\,min}

\title{볼록 최적화 정리 노트}
\author{홍길동}
\date{\today}

\begin{document}
\maketitle

\section{볼록 함수}
\begin{definition}
함수 $f:\R^n \to \R$가 모든 $x,y$와 $\lambda\in[0,1]$에 대해
\[ f(\lambda x + (1-\lambda) y) \le \lambda f(x) + (1-\lambda) f(y) \]
를 만족하면 $f$를 \emph{볼록 함수}라 한다.
\end{definition}

\begin{lemma}\label{lem:first}
미분 가능한 $f$가 볼록일 필요충분조건은 $f(y) \ge f(x) + \nabla f(x)^\top (y-x)$이다.
\end{lemma}

\begin{theorem}\label{thm:global}
볼록 함수의 국소 최솟값은 전역 최솟값이다.
\end{theorem}
\begin{proof}
$x^\ast$가 국소 최솟점이고 $f(y) < f(x^\ast)$인 $y$가 있다고 하자.
충분히 작은 $\lambda>0$에 대해 $z=\lambda y + (1-\lambda)x^\ast$는 $x^\ast$ 근처에 있고
$f(z) \le \lambda f(y) + (1-\lambda) f(x^\ast) < f(x^\ast)$이므로 모순이다.
\end{proof}

\begin{corollary}
볼록 함수에서 $\nabla f(x^\ast)=0$이면 $x^\ast \in \argmin_x f(x)$이다.
\end{corollary}

\begin{example}
$f(x)=\norm{Ax-b}_2^2$는 볼록이며, 정규 방정식 $A^\top A x = A^\top b$의 해가 최솟점이다.
\end{example}

\begin{remark}
정리~\ref{thm:global}은 보조정리~\ref{lem:first}로도 바로 보일 수 있다.
\end{remark}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 14. 알고리즘·코드 */
  add({
    id: "algo", name: "알고리즘·코드 문서", cat: "노트·예제", ico: "⌨", tags: ["algorithmicx", "listings", "의사코드"],
    desc: "의사코드(algorithmicx)와 색 입힌 코드(listings)를 함께 쓰는 기술 문서.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}
\usepackage{amsmath}
\usepackage{algorithm}
\usepackage{algpseudocode}
\usepackage{listings}
\usepackage{xcolor}
` + KO_NAMES_ART + R`
\floatname{algorithm}{알고리즘}
\renewcommand{\algorithmicrequire}{\textbf{입력:}}
\renewcommand{\algorithmicensure}{\textbf{출력:}}
\renewcommand{\lstlistingname}{코드}
\lstset{basicstyle=\ttfamily\small, keywordstyle=\color{blue!70!black}\bfseries, commentstyle=\color{gray}\itshape,
  stringstyle=\color{teal}, frame=single, rulecolor=\color{gray!40}, numbers=left, numberstyle=\tiny\color{gray},
  breaklines=true, showstringspaces=false, backgroundcolor=\color{gray!4}}

\title{경사 하강법 구현 노트}
\author{홍길동}
\date{\today}

\begin{document}
\maketitle

\section{알고리즘}
알고리즘~\ref{alg:gd}는 미니배치 경사 하강법이다.

\begin{algorithm}[h]
\caption{미니배치 경사 하강법}\label{alg:gd}
\begin{algorithmic}[1]
\Require 학습률 $\eta$, 반복 횟수 $T$, 초기값 $\theta_0$
\Ensure 학습된 매개변수 $\theta$
\State $\theta \gets \theta_0$
\For{$t = 1$ \textbf{to} $T$}
  \State 미니배치 $B_t$를 뽑는다
  \State $g \gets \frac{1}{|B_t|}\sum_{i \in B_t} \nabla_\theta \ell_i(\theta)$
  \State $\theta \gets \theta - \eta\, g$
  \If{$\lVert g \rVert < \epsilon$}
    \State \textbf{break}
  \EndIf
\EndFor
\State \Return $\theta$
\end{algorithmic}
\end{algorithm}

\section{파이썬 구현}
\begin{lstlisting}[language=Python, caption={Mini-batch gradient descent}]
import numpy as np

def sgd(grad, theta, data, lr=0.1, steps=100, batch=32, eps=1e-6):
    for t in range(steps):
        idx = np.random.choice(len(data), batch)
        g = grad(theta, data[idx])        # average gradient
        theta = theta - lr * g
        if np.linalg.norm(g) < eps:
            break
    return theta
\end{lstlisting}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 15. TikZ·그래프 */
  add({
    id: "tikz", name: "TikZ 그림·그래프 예제", cat: "노트·예제", ico: "📈", tags: ["TikZ 흐름도", "pgfplots 그래프", "벡터 그림"],
    desc: "코드로 그리는 그림 — 흐름도(TikZ)와 학습 곡선·막대 그래프(pgfplots). 그림 파일 없이 선명한 벡터.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning,shapes.geometric}
\usepackage{pgfplots}
\pgfplotsset{compat=1.17}
` + KO_NAMES_ART + R`

\begin{document}
\section{흐름도}
\begin{figure}[h]
\centering
\begin{tikzpicture}[node distance=9mm and 14mm,
  box/.style={rectangle, rounded corners=3pt, draw=blue!60, fill=blue!6, thick, minimum width=30mm, minimum height=9mm, align=center},
  dec/.style={diamond, aspect=2, draw=orange!70, fill=orange!8, thick, align=center, inner sep=1pt},
  arr/.style={-{Stealth[length=3mm]}, thick}]
  \node[box] (data) {자료 수집};
  \node[box, below=of data] (prep) {전처리};
  \node[box, below=of prep] (train) {모델 학습};
  \node[dec, below=of train] (ok) {성능\\충분?};
  \node[box, right=of ok] (tune) {하이퍼파라미터\\조정};
  \node[box, below=of ok] (deploy) {배포};
  \draw[arr] (data) -- (prep);
  \draw[arr] (prep) -- (train);
  \draw[arr] (train) -- (ok);
  \draw[arr] (ok) -- node[above] {아니오} (tune);
  \draw[arr] (tune) |- (train);
  \draw[arr] (ok) -- node[right] {예} (deploy);
\end{tikzpicture}
\caption{학습 파이프라인}
\end{figure}

\section{학습 곡선}
\begin{figure}[h]
\centering
\begin{tikzpicture}
\begin{axis}[width=0.8\linewidth, height=6cm, xlabel={에폭}, ylabel={손실}, grid=major, legend pos=north east, ymin=0]
  \addplot[blue, thick, mark=*] coordinates {(1,0.92) (2,0.61) (3,0.45) (4,0.37) (5,0.31) (6,0.28) (7,0.26) (8,0.25)};
  \addlegendentry{학습}
  \addplot[red, thick, dashed, domain=1:8, samples=40] {0.75*exp(-0.35*x)+0.24};
  \addlegendentry{검증}
\end{axis}
\end{tikzpicture}
\caption{에폭별 손실}
\end{figure}

\section{막대 그래프}
\begin{figure}[h]
\centering
\begin{tikzpicture}
\begin{axis}[ybar, bar width=14pt, width=0.8\linewidth, height=5.5cm, symbolic x coords={LSTM,GCN,제안}, xtick=data,
  ylabel={F1}, ymin=0.5, ymax=0.8, nodes near coords, nodes near coords align={vertical}]
  \addplot[fill=teal!60] coordinates {(LSTM,0.65) (GCN,0.68) (제안,0.72)};
\end{axis}
\end{tikzpicture}
\caption{모델별 F1}
\end{figure}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 16. 표·그림 배치 */
  add({
    id: "layout", name: "표·그림 배치 모음", cat: "노트·예제", ico: "▦", tags: ["subcaption", "multirow", "색 줄 표", "가로 넓은 표"],
    desc: "하위 그림 나란히(subcaption), 셀 합치기(multirow), 줄마다 색(rowcolors), 넓은 표(tabularx) 예제.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage[table]{xcolor}
\usepackage{kotex}
\usepackage[margin=22mm]{geometry}
\usepackage{graphicx}
\usepackage{subcaption}
\usepackage{booktabs}
\usepackage{multirow}
\usepackage{tabularx}
` + KO_NAMES_ART + R`

\begin{document}
\section{그림 나란히 놓기}
\begin{figure}[h]
  \centering
  \begin{subfigure}{0.31\linewidth}
    \includegraphics[width=\linewidth]{example-image-a}
    \caption{원본}\label{fig:a}
  \end{subfigure}\hfill
  \begin{subfigure}{0.31\linewidth}
    \includegraphics[width=\linewidth]{example-image-b}
    \caption{전처리 후}\label{fig:b}
  \end{subfigure}\hfill
  \begin{subfigure}{0.31\linewidth}
    \includegraphics[width=\linewidth]{example-image-c}
    \caption{예측 결과}\label{fig:c}
  \end{subfigure}
  \caption{처리 단계별 결과. 그림~\ref{fig:a}--\ref{fig:c}.}
\end{figure}

\section{셀 합치기}
\begin{table}[h]
  \centering
  \caption{자료 구성}
  \begin{tabular}{llrr}
    \toprule
    구분 & 세부 & 건수 & 비율 \\
    \midrule
    \multirow{2}{*}{학습} & 2021년 & 40{,}000 & 33\% \\
                          & 2022년 & 41{,}000 & 34\% \\
    \cmidrule(lr){1-4}
    평가 & 2023년 & 39{,}000 & 33\% \\
    \bottomrule
  \end{tabular}
\end{table}

\section{줄마다 색 · 넓은 표}
\begin{table}[h]
  \centering
  \rowcolors{2}{gray!8}{white}
  \caption{변수 설명}
  \begin{tabularx}{\linewidth}{lX}
    \toprule
    변수 & 설명 \\
    \midrule
    accident\_cnt & 지점별 주간 사고 건수(종속 변수) \\
    pop\_flow & 시간대별 유동 인구, 통신사 자료를 250\,m 격자로 모은 값 \\
    rain\_mm & 일 강수량. 결측은 가장 가까운 관측소 값으로 채웠다 \\
    \bottomrule
  \end{tabularx}
\end{table}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 17. 연구 노트 */
  add({
    id: "labnote", name: "연구 노트 (날짜별 기록)", cat: "노트·예제", ico: "📓", tags: ["날짜 항목", "할 일 체크", "회의 메모"],
    desc: "날짜별 실험·회의 기록 — 항목 명령(\\entry), 할 일 체크 상자, 결과 표. 하루 한 항목씩 덧붙이는 노트.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=22mm]{geometry}
\usepackage{amssymb}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage{booktabs}
\setlist{nosep}
\newcommand{\entry}[2]{\section*{#1 \hfill {\normalsize\color{gray}#2}}}
\newcommand{\todo}{$\square$~}
\newcommand{\done}{$\boxtimes$~}

\title{연구 노트 — 도시 안전 AI}
\author{홍길동}
\date{2026년 11월}

\begin{document}
\maketitle

\entry{2026-11-04 (수)}{실험}
\textbf{목표}: 그래프 층 수에 따른 성능 비교
\begin{itemize}
  \item 층 2개: F1 0.71
  \item 층 3개: F1 0.72 (과적합 시작)
\end{itemize}
\textbf{다음}:
\begin{itemize}[label={}]
  \item \done 드롭아웃 0.3 시험
  \item \todo 학습률 스케줄 비교
\end{itemize}

\entry{2026-11-03 (화)}{회의}
참석: 홍길동, 김연구. 결정: 평가 자료를 2023년으로 고정.

\entry{2026-11-02 (월)}{자료}
\begin{tabular}{lrr}
\toprule
자료 & 행 수 & 결측 \\
\midrule
사고 기록 & 120{,}000 & 0.4\% \\
유동 인구 & 2{,}300{,}000 & 1.2\% \\
\bottomrule
\end{tabular}
\end{document}
`,
    },
  });

  /* ------------------------------------------------------------ 18. 빈 문서 */
  add({
    id: "blank", name: "빈 문서", cat: "노트·예제", ico: "⬜", tags: ["최소"],
    desc: "한국어가 되는 가장 작은 문서에서 시작.",
    main: "main.tex",
    files: {
      "main.tex": R`\documentclass[11pt,a4paper]{article}
\usepackage{kotex}
\usepackage[margin=25mm]{geometry}

\begin{document}
여기에 쓰세요.
\end{document}
`,
    },
  });

  window.PAPERTPL = { list: list, bib: BIB, cats: ["논문", "학위·보고서", "발표·포스터", "투고·서신", "노트·예제"] };
})();

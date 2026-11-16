<div align="center">

# ScholarFlow

**An AI-powered, self-hosted workspace for research and learning.**
Read your sources with an AI that cites the page, turn them into reports, papers and slides, and study reading material — all on your own machine.

[한국어 README](README.ko.md) · [License](LICENSE) · [Screenshots](#screenshots)

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![No build step](https://img.shields.io/badge/build%20step-none-0f6b62)
![Storage](https://img.shields.io/badge/storage-files%20%7C%20SQLite-0f6b62)
![License](https://img.shields.io/badge/license-Use--Only-lightgrey)

<img src="docs/screenshots/02-dashboard.jpg" alt="Today's research dashboard" width="100%">

</div>

---

## Why ScholarFlow

Research work is usually scattered: PDFs in one folder, notes in another app, a chat assistant in a browser tab that never sees your files, a slide tool, a reference manager, and a word processor. ScholarFlow puts those steps in **one self-hosted workspace** where the AI works **on your own documents** and every answer points back to the page it came from.

- **Lightweight.** A single Python standard-library server (`serve.py`) and plain HTML/JS. No Node build, no external database, no container required. Data lives in a folder or one SQLite file — copy the folder to move it.
- **AI-first, but grounded.** Questions, summaries, drafts, reviews and slides are generated from the project's own sources, with page-level citations you can click to jump to.
- **Bring your own model.** Connect any OpenAI-compatible endpoint (local vLLM/Ollama-style servers or cloud), or the Claude CLI. Keys are encrypted on the server and never sent back to the browser.
- **Yours.** Accounts, per-account data ownership with explicit sharing, audit logs and hourly/daily/monthly backups — on your hardware.

## Highlights

| | |
|---|---|
| 🔬 **Research projects** | Upload PDF, Word, PowerPoint, Excel, HWP/HWPX, images, audio/video, text and code. Read them in a built-in viewer with search, highlights, page notes and bookmarks. |
| 💬 **Grounded AI chat** | Ask about the page you are reading or the whole project. Answers cite pages and jump the viewer there. Select text for one-click *Ask · Simplify · Translate · Collect · Put in document*. |
| 📝 **Report studio** | A paged A4 editor (Word / Google Docs style) with styles, numbered headings, tables, figures, equations, charts, footnotes and a table of contents. An AI block editor rewrites, inserts or removes sections with undo. Export to DOCX, PDF, HTML, Markdown and PPTX. |
| 📄 **Paper studio** | A LaTeX workspace in the browser: file tree, editor with autocomplete, instant HTML preview, 18 templates (IEEE, Elsevier, Beamer …), BibTeX lookup, and server-side PDF compile with SyncTeX when a TeX engine is installed. |
| 🎬 **Slide studio** | Build decks on a canvas with layouts, themes, shapes, tables and charts, speaker notes, presenter view and rehearsal. Export real PPTX, PDF, HTML or Beamer. |
| 📚 **Literature lab** | Search OpenAlex, keep a reading board, fill comparison tables with AI, find research gaps and missed key papers, and send related work to your paper or report. |
| 🎯 **Mock review** | Score a draft against an evaluation rubric with an AI review panel, list critical weaknesses and fixes, and rehearse Q&A. |
| 🔭 **Deep research & meetings** | Plan sub-questions, gather evidence with confidence levels, and keep AI meeting minutes with action items. |
| 🤖 **Background AI tasks** | Long jobs (source triage, literature review, review loops, pre-submission checks) run on the server, resume after restarts, and propose changes as cards you approve. |
| 📖 **Library mode** | Read HTML study documents with filters, a reading mate, highlights, notes, spaced-repetition review cards, written-answer practice, concept maps and study plans. |
| 🛡 **Accounts & operations** | Server accounts and sessions, per-account features, data ownership with view/edit sharing, audit logs, backups and restore, optional SSO and cross-system account linking, a break-glass admin that can only be configured on the server PC. |

## Screenshots

> All screenshots use fictional demo data. AI panels show *AI not connected* because the demo instance has no model attached.

### Research

| | |
|---|---|
| **Today's research** — what to do next, why, and where your time went<br><img src="docs/screenshots/02-dashboard.jpg" width="100%"> | **Projects** — status, deadlines, links, table/card/tree views<br><img src="docs/screenshots/03-projects.jpg" width="100%"> |
| **Project workspace** — sources, documents and grounded chat<br><img src="docs/screenshots/04-workspace-chat.jpg" width="100%"> | **Document viewer** — page view with text layer, thumbnails and AI side panel<br><img src="docs/screenshots/05-viewer.jpg" width="100%"> |
| **Select & act** — highlight, ask, simplify, translate, collect<br><img src="docs/screenshots/06-viewer-select.jpg" width="100%"> | **Report studio** — paged editor with AI block editing<br><img src="docs/screenshots/07-report.jpg" width="100%"> |
| **Paper studio** — LaTeX templates and workspace<br><img src="docs/screenshots/08-paper.jpg" width="100%"> | **Slide studio** — decks, layouts, presenter tools<br><img src="docs/screenshots/09-slides.jpg" width="100%"> |
| **Literature lab** — OpenAlex search and reading board<br><img src="docs/screenshots/10-literature.jpg" width="100%"> | **Mock review** — rubric scoring by an AI panel<br><img src="docs/screenshots/11-review.jpg" width="100%"> |
| **Deep research** — plan, evidence, confidence<br><img src="docs/screenshots/12-deep-research.jpg" width="100%"> | **Meetings, surveys & memos**<br><img src="docs/screenshots/13-meeting.jpg" width="100%"> |
| **Background AI tasks**<br><img src="docs/screenshots/14-ai-tasks.jpg" width="100%"> | **Project information** — plan, budget, goals, timeline<br><img src="docs/screenshots/15-project-info.jpg" width="100%"> |
| **Activity timeline & storage status**<br><img src="docs/screenshots/16-timeline.jpg" width="100%"> | |

### Library

| | |
|---|---|
| **Library** — filters, list/card/tree views<br><img src="docs/screenshots/17-library.jpg" width="100%"> | **Reader** — table of contents, reading mate, related documents<br><img src="docs/screenshots/18-library-reader.jpg" width="100%"> |
| **Review cards** (spaced repetition)<br><img src="docs/screenshots/19-review-cards.jpg" width="100%"> | **Notes hub**<br><img src="docs/screenshots/20-notes.jpg" width="100%"> |
| **Study plan**<br><img src="docs/screenshots/21-study-plan.jpg" width="100%"> | |

### Settings, administration & more

| | |
|---|---|
| **Login**<br><img src="docs/screenshots/01-login.jpg" width="100%"> | **Display settings** — palettes, light/dark, left or top menu, fonts<br><img src="docs/screenshots/22-settings.jpg" width="100%"> |
| **Dark mode**<br><img src="docs/screenshots/23-dark.jpg" width="100%"> | **Accounts & server administration**<br><img src="docs/screenshots/24-admin.jpg" width="100%"> |
| **AI connection** — OpenAI-compatible endpoints, Claude CLI, import/export<br><img src="docs/screenshots/25-ai-connection.jpg" width="100%"> | **Break-glass admin** — password set only from the server PC<br><img src="docs/screenshots/26-local-admin.jpg" width="100%"> |
| **Mobile**<br><img src="docs/screenshots/27-mobile.jpg" width="40%"> | |

## Quick start

```bash
git clone https://github.com/UniverseMaker/ScholarFlow-Learning-Assist.git
cd ScholarFlow-Learning-Assist
python -m pip install -r requirements.txt        # optional, enables PDF/Office/HWP and DOCX/PPTX
python serve.py 18162 --data-dir=./data          # http://127.0.0.1:18162
python tools/local_admin.py set --data ./data    # set the admin password (server PC only)
```

1. Open `http://127.0.0.1:18162` and sign in as `admin`.
2. Go to **Settings → AI connection** and add an OpenAI-compatible endpoint, model and key (or the Claude CLI).
3. **Research → Projects → New project**, then upload your sources and start asking.

**Requirements:** Python 3.10+. The server itself uses only the standard library; the optional packages in `requirements.txt` add PDF/Office/HWP viewing and DOCX/PPTX export. On Windows, an installed Microsoft Office or Hancom Office can be used for original-layout previews. A TeX engine (tectonic or xelatex) on the server enables paper PDF compile.

## How it works

```
Browser (HTML/JS, no build) ──►  serve.py  (Python stdlib HTTP server)
                                   ├─ tools/ws_api.py     projects, sources, documents, versions, exports
                                   ├─ tools/llm_api.py    AI connections (keys encrypted), streaming proxy
                                   ├─ tools/aitask_api.py background AI tasks (resumable)
                                   ├─ tools/auth_api.py   accounts, sessions, CSRF, lockouts, audit
                                   ├─ tools/vfs.py        storage: plain files or one SQLite file
                                   └─ tools/backup_api.py hourly / daily / monthly snapshots
```

- **Data folder** (`--data-dir`): accounts, projects, documents, logs and backups. Move the folder to move the installation.
- **Security:** PBKDF2 passwords (bcrypt for the break-glass admin), HttpOnly session cookies, CSRF checks, failed-login lockout, security headers, per-account data ownership with explicit view/edit sharing, audit logs.
- **Assets:** after editing front-end files, run `python bump-assets.py <build>` to refresh per-file cache hashes.

## Adding library documents

Put a single-file HTML document in `app-html/library/docs/<id>.html` and run `python tools/build_catalog.py`. The format and templates are described in the in-app **Help → Library documents** and `app-html/help/templates/`.

## License

ScholarFlow is **source-available, not open source**, under the [ScholarFlow Use-Only License](LICENSE):

- ✅ Free to download, install and **use** unmodified for personal, educational, research or internal organizational purposes. What you create with it is yours.
- ❌ No modification or derivative works, no redistribution or resale, no hosting it as a service for third parties, no inclusion in other products — without written permission.
- Bug reports and suggestions are welcome via Issues. Pull requests only by prior agreement.

Third-party components keep their own licenses: Pretendard Variable font (SIL OFL 1.1); CodeMirror and KaTeX are loaded from public CDNs at runtime.

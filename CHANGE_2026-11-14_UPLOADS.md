# Change record — judgment upload & ingestion (2026-11-14)

**Requested by the owner:** users can upload a judgment PDF on the website. The system processes it with the research data pipeline and stores the chunks in Qdrant, so the research agent can search it.

## What it does
```
PDF upload (website or POST /api/uploads)
 -> text layer per page (pypdfium2)
 -> corruption score per page (same signatures as EXP14/EXP11, per 1,000 Devanagari letters)
 -> damaged pages (> 10 per 1,000, or < 50 Devanagari letters) re-read with OCR (EasyOCR mr+en, offline weights;
    word boxes rebuilt into lines so the chunker sees a Tesseract-like layout)
 -> ACPMC chunks (header first; numbered paragraphs; order; disclaimer; context prefix)
 -> multilingual-e5-large 'passage: ' vectors -> Qdrant collection 'vidhigya_uploads'
    (embedded store database/uploads/qdrant, or a server via QDRANT_URL)
 -> BM25 over uploaded chunks + SQLite registry database/uploads/uploads.db -> status 'ready' (searchable)
```
- **Search:** at question time, the uploads' BM25 and Qdrant lists join the corpus BM25 and E5 lists in the same RRF fusion. The bge reranker, the in-judgment paragraph selection, the agent, claim checking and the case gate then treat uploaded judgments exactly like corpus judgments.
- **IDs:** uploaded judgments get the ID `up_<sha256[:16]>`. A re-upload of the same file is detected as a duplicate.

## Safety properties
1. **The frozen corpus indexes are not modified.** The 98,509-passage BM25 index, the E5 vector file and the `vidhigya.db` registry are untouched. Uploads live in `database/uploads/`.
2. **With no uploads, retrieval is the frozen configuration.** The upload branch runs only if at least one upload is indexed, and `rrf()` returns exactly the same list as before.
   - **Regression test (5 DEV queries vs the frozen K24 production-stack rankings):** top-5 judgments identical in 5/5; full top-20 identical in 4/5. The one difference is a tie order between the Kaggle GPU and this laptop's CPU.
3. **The evaluated agent is unchanged.** `vidhigya_agent.py`, the frozen prompt, the structured citations and the tokeniser are byte-identical to `CONFIG_FREEZE_2026-11-13.json`.
4. **Switches:**
   - `UPLOADS_IN_SEARCH=0` removes uploads from search entirely.
   - `UPLOAD_CHUNKER=paragraph` uses the corpus chunker instead of ACPMC.

## Files
| File | Change |
|---|---|
| `backend/app/chunking.py` | **new.** ACPMC (identical to the research builder: 80/80 judgments produce identical chunks) + paragraph chunker |
| `backend/app/ingest.py` | **new.** Upload worker, OCR routing, Qdrant + BM25 store, list/delete |
| `backend/app/retrieval.py` | `_texts`/`_doc_chunks` read uploaded chunks; `rrf_many`; uploads join the fusion only when present |
| `backend/app/generation.py` | case gate (`head2`) reads the uploaded judgment's header chunks |
| `backend/app/agent.py`, `pipeline.py` | passage text lookup includes uploads |
| `backend/app/main.py` | `POST/GET/DELETE /api/uploads`; the judgment page and PDF view support uploads; the evidence panel shows upload metadata |
| `backend/app/config.py` | upload settings (`UPLOADS_DIR`, `QDRANT_URL`/`QDRANT_PATH`, `UPLOAD_CHUNKER`, `OCR_*`, `MAX_UPLOAD_MB`, `UPLOADS_IN_SEARCH`) |
| `backend/requirements.txt` | `qdrant-client`, `pypdfium2`, `easyocr`, `python-multipart` |
| `frontend/src/pages/Upload.tsx` + `api.ts`, `main.tsx`, `Shell.tsx`, `i18n.tsx` | **new Upload page** (English/मराठी/हिंदी): drag-and-drop, live 6-step progress, quality stats, open, delete |

The new hashes are in `CONFIG_FREEZE_2026-11-14_uploads.json`. The 13 Nov freeze is kept unchanged as evidence.

## Tests (2026-11-14)
- **Ingestion:** a real severely damaged judgment (6 pages) gave:
  - corruption **84.3 → 5.0** per 1,000 letters;
  - all 6 pages OCR'd; 3 ACPMC chunks; 3 Qdrant points + BM25;
  - title from the caption: "महाराष्ट्र राज्य आणि इतर विरुद्ध उमाशंकर राजाभाऊ व इतर".
- **Retrieval:** a question naming the case returned the uploaded judgment at **rank 1**. The case gate reads its header.
- **Robustness:**
  - a non-PDF is rejected (400);
  - a duplicate upload is detected;
  - each document is processed once;
  - delete removes the chunks, the Qdrant points and the file.
- **Frontend:** the TypeScript build passes, and the Upload page renders and shows live progress (checked in the browser).
- **Production run** (`uvicorn app.main:app --port 8077`), a 4-page judgment with corruption 112.2:
  - **The first attempt failed.** EasyOCR crashed on a degenerate text box (`cv2.resize: !ssize.empty()`).
  - **The fix:** a crashing page is retried while ignoring tiny boxes (`min_size=20`); if it still fails, that page keeps its text layer and the document is flagged instead of failing. The UI now shows such warnings on finished uploads.
  - **After the fix:** **ready in 156 s**; corruption **112.2 → 4.3**; 4/4 pages OCR'd; 3 chunks.
  - The title was read from the caption ("बिहार राज्य विदरुयत मंडळ विरुद्ध अखिल कृष्ण मित्रा आणि इतर"; "विदरुयत" is an OCR error for "विद्युत").
  - The judgment page and "Open source PDF" work for the upload.
- **Server start:** start with `PRELOAD=0` on a 16 GB CPU machine. Retrieval then loads on the first question instead of competing with OCR for memory.

## Admin login for the upload side (added 2026-11-14 ~11:40, owner request)
- **What is protected:** `POST /api/uploads`, `GET /api/uploads[/{id}]` and `DELETE /api/uploads/{id}` require `Authorization: Bearer <token>`. The token comes from `POST /api/uploads/login` with the admin password.
- **What stays public:** judgment pages, PDFs and research. Citations to uploaded judgments must stay viewable.
- **Password storage:** never stored in plain text. Only a salted PBKDF2-SHA256 hash (310,000 iterations) is kept, in `database/uploads/admin_auth.json`, outside the source code.
  - To change it, run `python -m app.auth set` on the server (prompts without echo). Changing it ends all sessions.
- **Sessions:** random tokens kept in memory, expiring after 12 h (`ADMIN_SESSION_HOURS`). Logout ends the session. A server restart ends all sessions.
- **Lockout:** 5 wrong passwords from one client lock it out for 60 s.
- **Frontend:** the Upload page shows an admin sign-in screen first and has a Sign out button. The token is kept only for the browser tab.
- **Tests:**
  - list, upload and delete without login → 401;
  - wrong password → 401; correct password → token; list and upload with the token → 200/202;
  - forged token → 401; token after logout → 401;
  - 5 wrong attempts → 60 s lockout;
  - the public judgment page → 200;
  - browser sign-in → the upload page opens.

## Limitations
- **OCR engine:** EasyOCR on CPU, about 20–60 s per damaged page. Research V2 used Tesseract, which was comparable on the D4 sample.
- **ACPMC validation:** ACPMC is the default as the owner requested. Its retrieval benefit is significant in Stage A (BM25, full corpus); the GPU Stage B/C result is pending.
- **Metadata:** the case number is filled only when the caption matches the case-number pattern.
- **Access control:** a single admin password, with no user accounts. Serve it over HTTPS before exposing it beyond localhost; otherwise the password and token travel unencrypted. The default password given by the owner is short, so choose a longer one for public use.

## UI changes (2026-11-14 ~15:00, owner request)
- **Wording:** "Research" is removed from the interface in all three languages. The nav reads Ask · Upload · Experiments · Architecture · Dashboard, and buttons read "Ask", "New question" and "Ask a Legal Question". URLs (`/research/...`) are unchanged, so saved links keep working.
- **Experiments page** (`/experiments`, nav button "Experiments"):
  - lists all 95 experiments, live from the experiment register (`GET /api/experiments`, read-only);
  - series tabs: October paper, 9–11 Nov, Current system, New experiments;
  - status counts, search, and expandable rows with results, findings, methods and source paths;
  - expected outcomes of proposed experiments are labelled as hypotheses, not results.
- **Courtroom backdrop** (`components/CourtroomBackdrop.tsx`):
  - a faint (about 8%) original vector silhouette behind every page: judge at the raised bench under the scales emblem, columns, clerk, two advocates in gowns at lecterns, public gallery;
  - decorative only (`aria-hidden`, no pointer events), and no photograph or third-party image.

## Full-Marathi mode (2026-11-14 evening, owner request: "ya test these and implement in our ui" / "i tested these imorove so use these")
- **What changed:** an English or mixed-script question is translated **once** into Marathi before the agent starts (`backend/app/qtranslate.py`).
  - Case numbers, years and section numbers must survive the translation exactly, and the output must be mostly Devanagari. Otherwise the original question is used and the reason is recorded.
  - The whole agent then runs on the Marathi question: search, splitting, coverage, case check, answer and claim check.
  - For English questions, the verified Marathi answer is translated back into English as a reading copy. The copy is rejected if any citation marker changes. The Marathi answer stays the answer of record.
- **Detection** (`language()`): Devanagari letter share ≥ 0.85 → Marathi (no change); ≤ 0.15 → English; otherwise mixed.
- **Switch:** `QUERY_TRANSLATE=0` restores the previous behaviour.
- **Stored with each run:** `agent.query_translation` = `{original, language, marathi, used, translated, reason}`, and the English copy goes in `run_translations`.
- **UI** (`RunView.tsx`):
  - a banner under the question shows "Searched and answered in Marathi as: …", or "Your question was used as written" with the reason;
  - English questions open on the English reading copy, and the Marathi original is one click away.
- **Unchanged:** the frozen agent (`vidhigya_agent.py`), retrieval, prompts, gate and the K14 evaluated configuration. Only the input question is changed.
- **Evidence status:**
  - this is *not* a formally evaluated change;
  - the supporting evidence is EXP15 (K22/K23: translating into English did not help, and Marathi questions scored 0.675 on the same items) plus the owner's informal test;
  - the formal test (160 English/mixed DEV questions, agent on the Marathi translations, 3-judge majority) is planned as NEW-34b. Until it runs, no accuracy claim is made for English or mixed questions.
- **Translation fix after the first live test:** gemma rendered "bail" as a non-word ("झीरोन").
  - Added a fixed glossary of 50 standard Marathi legal terms (`GLOSSARY` in `qtranslate.py`). Only the terms present in a question are added to the prompt.
  - One retry happens if a term is missing. The check tolerates Marathi inflection (`has_term`; e.g. जामीन → जामिनाच्या).
  - Numbers are kept in the digits the user typed.
  - Re-test: "bail" → "जामिनाच्या अर्जाबाबत" (correct).

## Experiments page: superseded experiments hidden (2026-11-14, owner request "remove all suspended exp")
- The 8 experiments with status HIST (superseded: O-01, O-02, O-16, O-21, O-23, O-26, H-01, H-05) are no longer shown. The page lists 87 (50 previous + 37 new).
- They are **not deleted**: they remain in the experiment register (`content.json`, master register xlsx and report) as research evidence. The API reports how many are hidden (`hidden_superseded`).
- **Update (owner request "remove all suspended experiment or failed experiment from ui"):** the 4 invalid/failed experiments (INV: O-05, O-06, H-02, HUM-1) are hidden as well. The page lists 83 (46 previous + 37 new). They are still in the register and the report; the API returns the hidden counts (`hidden: {HIST: 8, INV: 4}`).

## Architecture page: agentic workflow diagram and technology stack (2026-11-14)
- **New `components/AgentWorkflow.tsx`:**
  - one SVG diagram of the whole agentic workflow, drawn from the actual LangGraph wiring in `vidhigya_agent.py`:
    - question → language check → translate once to Marathi;
    - LangGraph StateGraph: START → understand → retrieve → build_pool → assess_coverage → (gap and round < 2) followup → assess_coverage … → synthesize → verify → gate → END;
    - the tools each node calls (hybrid retriever, judgment store, Ollama gemma3:12b, deterministic case gate);
    - the admin upload path into the store;
    - the answer / abstention output, with the English reading copy;
  - a 12-card technology grid: LangGraph, Ollama, hybrid retrieval, reranker, Qdrant + SQLite, OCR + ACPMC, full-Marathi mode, verification, FastAPI + SSE, React, bounded autonomy, local-only.
- The orchestration framework is **LangGraph** (not Langflow).
- The existing step-by-step view stays below, under "Each step in detail".
- **Second diagram (owner request "add one more diagram like how uploading pdf doc"):** `UploadWorkflowDiagram` on the Architecture page, drawn from `ingest.py`. It has four stages:
  1. **receive:** admin sign-in, %PDF and 50 MB checks, SHA-256 de-duplication, background queue;
  2. **clean page by page:** text layer, damage score, OCR only when the score is > 10 or the page has < 50 Devanagari letters (EasyOCR, falling back to the text layer);
  3. **chunk and index:** ACPMC, E5 passage vectors, Qdrant + SQLite, BM25 rebuild;
  4. **searchable at once** through 4-list RRF, with the frozen corpus index never changed.

## History page (2026-11-14 ~17:05, owner request "add history panel")
- New `/history` page (`frontend/src/pages/History.tsx`), with a **History** item in the top menu.
- It lists the last 50 questions from the run log (`GET /api/research`), newest first.
- **Features:**
  - filters with counts: All / Answered / Not found–abstained / Running / Saved;
  - text search;
  - a language tag on each question (मराठी / English / Mixed);
  - an outcome chip and time on each row;
  - the list refreshes every 15 s, so running questions update live;
  - one click opens the full report (answer, cited passages, claim checks, agent trace).
- The existing sidebar on the Ask page stays, but it is hidden on narrow screens; this page works at any width.
- **Ask page subtitle updated:** English and mixed questions are now said to be translated into Marathi first (full-Marathi mode), instead of "lower retrieval quality".
- **Demo preparation:** 3 Marathi DEV questions were queued so that finished answers exist in History for a presentation (`27b9eb2eaab3`, `d84050fa5808`, `92a32541684d`).
  - They were chosen from DEV items the agent answered correctly in K12. This is a **demonstration selection, not an evaluation sample**.
  - About 30–40 min each on this CPU-only laptop.

## Delete in History, whole-interface translation, LLM-agnostic generator (2026-11-14 ~17:10, owner requests)
- **Delete a question:** `DELETE /api/research/{run_id}` removes the run with its evidence, claim checks, events and translations. A queued or running question is refused (409).
  - The History page has a trash button per row, with a confirmation prompt; it is disabled for running questions.
  - Tested on an isolated copy of the database (port 8078): deleted → all 5 tables empty for that run; second delete → 404; running → 409. The live database was untouched.
- **Whole-interface translation:** `uiTranslations.ts` holds about 330 fixed UI strings with Marathi and Hindi versions, translated by hand. `components/DomTranslate.tsx` swaps exact matches in the page (text, placeholder, title, aria-label) when मराठी or हिंदी is chosen, and restores English.
  - **Never changed:** questions, answers, evidence and judgment text, technical names, and the research data rows on the Dashboard and Experiments pages.
- **LLM-agnostic generator:**
  - `GET /api/models` lists the chat models installed in the local Ollama (embedding, vision and code models are excluded);
  - `POST /api/models/select` switches the generator for new questions. It is refused while a question is queued or running, so no answer mixes models;
  - the choice is saved in `database/llm_choice.json` and survives restarts; an env `GEN_MODEL` still overrides it;
  - each run stores the generator in its saved configuration;
  - **UI:** a CPU-chip menu after the language menu, with gemma3:12b marked "validated" and models under 5 GB marked "fast";
  - with any model other than gemma3:12b, a warning banner on every page says the answers come from a model that was not evaluated;
  - a future GPU model only needs `ollama pull <name>` to appear in the menu.
- **Fast model for this CPU laptop:** gemma3:4b (3.3 GB, same family as the validated model).
  - Its accuracy is **not measured**; reported accuracy (0.633 TEST) is for gemma3:12b only.
- **Verified in the browser (2026-11-14 ~18:40):**
  - the LLM menu lists 13 installed chat models;
  - selecting gemma3:4b switched the generator, the choice survived a restart, and the amber warning bar appeared on every page;
  - in Marathi mode the whole History page, the navigation and both Architecture diagrams switched; questions stayed as asked.
- **Fixed during the check:**
  - the translator turned the language menu's own "मराठी" into "Marathi". It now restores only text it changed itself;
  - `index.html` is now served with `Cache-Control: no-cache`, because a browser had kept an old interface after a rebuild.

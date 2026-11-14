# VIDHIGYA — Final Selected Architecture

Status (final, 2026-11-13): **production runs the agentic configuration, K12 arm F; selected on DEV and confirmed on held-out TEST.**
"Accuracy" means automatic 3-LLM-judge majority (gemma3:12b, qwen3:14b, mistral-nemo:12b), **not human legal review**. The judges agree
poorly (Fleiss κ 0.20 on answers), so these are approximate machine estimates. Full report: `VIDHIGYA_Q1_COMPLETE_RESEARCH/FINAL_VALIDATION_REPORT.md`.

## 0. Final selection and results (supersedes the provisional numbers in §2–§4)

**Deployed:** the LangGraph agent, which runs understand → retrieve (same retrieval stack as §1) → evidence pool ≤ 8 × 1,500 chars → coverage check → follow-up research ≤ 2 rounds → synthesis (gemma3:12b, frozen-B citation prompt) → claim verification → evidence gate. The settings are byte-identical to the K12/K14 runs, and file hashes are in `CONFIG_FREEZE_2026-11-13.json`.

**How it was selected:** pre-registered rule 1, the agentic arm with the highest DEV accuracy. The record is `SELECTION_K12.json`: selected 2026-11-13 02:16:38, before any TEST answer was judged.

| | DEV (109) | TEST (139) |
|---|---|---|
| **Agent F (deployed)** | **0.679** | **0.633** [0.550, 0.709] |
| Fixed pipeline (verify + gate, = K12 arm E / K10 gated) | 0.633 | 0.561 (agent +0.072, Holm p = 0.099, n.s.) |
| Normal single-pass gemma3:12b | 0.587 | 0.446 (agent +0.187, p < 0.001) |
| Frozen System B | 0.073 | 0.065 (agent +0.568, p < 0.001) |

**TEST, agent F:**
- correct abstention 0.76
- precision when answered 0.73
- claim support 0.86
- unsupported claims 0.045
- contradicted claims 0

**Production system test (K13):** 89/90 checks pass. The only failure is in fixed mode: over-abstention on a simple English question.

**Not met:** the 0.80 minimum and 0.95 target. The main remaining error is over-abstention by the case gate.

**Resolved since the provisional text below:**
- EXP03 cleaned vs original text: +0.06, n.s.
- EXP04 paragraph ranking at answer level: −0.01 to −0.06, n.s. inDoc3 is kept for its passage-recall gain.
- Judge agreement: final κ is 0.20, not the provisional 0.36.

*§1–§4 below are the original record of the fixed-pipeline selection (DEV, provisional judging), kept unchanged for traceability. That pipeline remains available as `ARCHITECTURE=fixed`.*

## 1. Selected configuration (production default)

| Stage | Component | Exact setting | Source of evidence |
|---|---|---|---|
| Query processing | Unicode NFC, whitespace normalisation | Marathi, English and mixed script accepted | frozen System B |
| Lexical retrieval | BM25Okapi (k1 1.5, b 0.75) | production index `bm25_index_clean_v1`, top 100 | EXP07 |
| Dense retrieval | `intfloat/multilingual-e5-large` | `query:` prefix; corpus vectors over cleaned text (K04), cosine, top 100 | EXP07 |
| Fusion | Reciprocal Rank Fusion | k = 60, keep 100 | EXP07 |
| Reranking | `BAAI/bge-reranker-v2-m3` | rescore fused top 30, max_length 512 | EXP07 |
| Paragraph selection | within-judgment rerank "inDoc3 + docprior" | all chunks of the top 3 judgments rescored by bge-reranker (first 2,000 chars), + 0.5 / (judgment rank) | EXP07b |
| Context | top 6 paragraphs × 1,500 chars, evidence IDs E001… | | K06/K10 |
| Generation | `gemma3:12b` via Ollama | frozen-B prompt, JSON-schema structured citations, T 0.1, num_ctx 16384, num_predict 1024, seed 20261111 | K05b, K06, K10 |
| Claim verification | claim_split v2 + per-claim check by the same model | T 0, JSON `{supported: bool}`; unsupported sentences removed; nothing left → abstain | K06, K08 |
| Citation validation | structured_citations (frozen B) | every cited ID must exist in the evidence set; schema-valid JSON | frozen System B |
| Abstention gate | deterministic case gate G_det | question names a case number (n/yyyy) or "X विरुद्ध Y" parties that no retrieved judgment's first two chunks contain → abstain | EXP10 gate analysis (selected on DEV) |

## 2. Why this configuration (DEV, 109 questions: 88 answerable, 21 unanswerable)

| System (DEV) | E2E accuracy [95% CI] | Correct abstention (unanswerable) | False answers to unanswerable | Precision when answered |
|---|---|---|---|---|
| Frozen System B (B_FROZEN_live) | 0.073 [0.038, 0.138] | 0.048 | 20 | 0.088 |
| Production /api/ask (B_PROD_ask) | 0.083 [0.044, 0.150] | 0.429 | 0 | 0.000 |
| K05a ask qwen2.5:7b (A3) | 0.174 [0.115, 0.256] | 0.000 | 20 | 0.229 |
| K05b structured gemma3:12b top5×800 (S3) | 0.349 [0.266, 0.442] | 0.143 | 18 | 0.461 |
| K06 qwen2.5:7b + verification + G_det | 0.413 [0.325, 0.507] | 0.905 | 2 | 0.722 |
| K06 gemma3:12b raw | 0.532 [0.439, 0.623] | 0.238 | 16 | 0.609 |
| K06 gemma3:12b + verification | 0.569 [0.475, 0.658] | 0.238 | 16 | 0.663 |
| K06 gemma3:12b + verification + LLM gate (gated2) | 0.284 [0.208, 0.375] | 1.000 | 0 | 0.769 |
| **K06 gemma3:12b + verification + G_det (selected)** | **0.615 [0.521, 0.701]** | **0.857** | **3** | **0.721** |

Reasons, in the order of the selection criteria:
1. **Correctness** — highest DEV end-to-end accuracy of every evaluated system; its CI does not overlap the frozen System B CI.
2. **Retrieval** (EXP07, 169 Marathi questions, judgment level): hybrid E5-clean + bge-reranker MRR 0.794 vs production 0.752;
   Hit@1 0.757 vs 0.692. Passage level with within-judgment rerank: Recall@10 0.740 vs 0.592 (best judgment-level config) and 0.396 (production).
3. **Evidence coverage** — 6 × 1,500 chars instead of frozen B's 3 × 300.
4. **Citation/provenance** — structured citations; verification removes claims the cited evidence does not support
   (DEV claim unsupported/no-citation rate 0.013 vs 0.315 for frozen B).
5. **Claim verification** — +0.037 E2E over raw gemma (0.532 → 0.569) at the same answer coverage.
6. **Abstention** — G_det raises correct abstention on unanswerable questions from 0.238 to 0.857 while keeping most answers;
   the LLM gate (gated2) abstains on everything (accuracy 0.284) and was rejected.
7. **Robustness** — retrieval MRR: Marathi 0.792, misspelt 0.776, paraphrased 0.719, mixed script 0.494, English 0.468 (limitation, see §4).
8. **Latency** — the cost of the improvements: generation p50 ≈ 21.5 s vs ≈ 4.7 s for frozen B (Kaggle T4; TEST runs). Verification adds one model call per claim.
9. **Reproducibility** — fixed seeds, temperature 0/0.1, pinned model names, all code and outputs hashed.
10. **Deployability** — all components are open models runnable offline (Ollama + Sentence-Transformers); no external API, so confidential judgments never leave the machine.

## 3. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Frozen System B / production /api/ask | DEV E2E 0.07–0.08; answers 20/21 unanswerable questions (frozen B) |
| qwen2.5:7b as generator (K06/K07/K10) | DEV E2E 0.413 vs 0.615 for gemma3:12b with the same pipeline |
| LLM case gate (gated2) | over-abstains: correct abstention 1.0 but E2E 0.284 |
| Production BM25 + mMiniLM reranker ranking (K7prod) | lower retrieval (MRR 0.752 vs 0.794); answer-level EXP03 comparison pending full judging |
| OCR text instead of the PDF text layer (EXP02b) | primary comparison null: OCR − layer MRR +0.004 [−0.097, +0.103] |
| Single-pass generation without verification | more unsupported claims (0.074 vs 0.013 on DEV) |

## 4. Open points and limitations (stated, not hidden)
- **TEST confirmation pending**: K10a (this configuration, 139 TEST questions) awaits the final judge majority.
- **EXP04 at answer level not yet conclusive**: the within-judgment paragraph rerank (inDoc3+docprior) clearly improves
  passage retrieval, but on DEV with qwen2.5:7b the raw-answer accuracy was 0.339 with it vs 0.367 without (n = 109; verified/gated
  arms still being judged). DEV evidence for gemma3:12b *with* inDoc does not exist; the K10 TEST run is its first evaluation.
  Production exposes `RANK_MODE=indoc|plain` so the choice can follow the final EXP04 result without code changes.
- Target 0.95 end-to-end accuracy is **not** reached (best DEV 0.615).
- English and mixed-script questions retrieve far worse than Marathi (MRR ≈ 0.47–0.49); G_det's party check reads Devanagari only.
- Judges agree only moderately (Fleiss κ ≈ 0.36 on correctness so far); results are automatic, not human legal review.
- Benchmark is silver (LLM-built, construction-checked); human verification pending (EXP01).
- 7 of 29 dev-history gold judgments are missing from the production index.
- CPU-only laptop: gemma3:12b answers take minutes; a GPU host (via `OLLAMA_URL`) is recommended for interactive use.

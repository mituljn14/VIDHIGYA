# Testing record (VIDHIGYA_PROD)

Recorded while the production system was built (12–14 November 2026).

| Test | Result |
|---|---|
| Registry build (5,819 unique judgments, 98,509 passages; vector rows = registry rows asserted) | pass |
| Backend start, model load (BM25, E5-large, bge-reranker-v2-m3) | pass (332 s on first load, mostly Hugging Face network checks) |
| `/api/health` reports components and flags non-validated generator | pass |
| Real retrieval on a DEV question (SB2-1ea1ef4ef3): all 6 evidence passages from the gold judgment 925a09e5bcd58fac | pass |
| Retrieval latency on CPU: BM25 2 s, E5 5 s, rerank 64 s, paragraph selection 81 s | measured |
| Generation with validated gemma3:12b | **not run locally**: Ollama 0.17.1 cannot pull gemma3:12b, and 16 GB RAM cannot hold it with the retrieval models |
| End-to-end run 1 (dev generator qwen3:4b-instruct, num_ctx 16,384, all models resident) | **FAIL**: retrieval OK in 2.5 min, generation timed out after 30 min — free RAM fell to ~0.5 GB of 16 GB (retrieval models ~5 GB + LLM + KV cache), heavy swapping |
| Fix: `LOW_MEMORY=1` releases E5 + reranker before generation (same weights reloaded next question; results unchanged), `HF_HUB_OFFLINE=1` at start-up, timeout 60 min | implemented |
| End-to-end run 2 (LOW_MEMORY=1, dev generator qwen3:4b-instruct, DEV question SB2-1ea1ef4ef3) | **completes** in 54 min on CPU (BM25 3.6 s, E5 4.9 s, rerank 91 s, paragraph selection 102 s, generation 47.7 min, verification 2.7 min). All 6 evidence passages from the gold judgment; the draft answer matched the reference (5 purple shawls, cited E001) but the verifier rejected the claim -> abstained_no_verified_claim. Recorded as an error case: verifier over-rejection on extraction-damaged text (small fallback model; to be measured with gemma3:12b in K12/K13) |
| Frontend type-check (strict) + production build | pass (114 KB gzipped JS) |
| Routes `/`, `/architecture`, `/dashboard`, `/research`, `/research/:id`, `/judgments/:id` render; Marathi text renders (Noto Sans Devanagari) | pass (screenshots) |
| Live stage timeline over SSE during a run | pass |
| No mock data: every number comes from `/api/health`, `/api/evaluation` (research result files) or a stored run | verified by code review |
| Interface language switch (English / मराठी / हिंदी) renders all main screens | pass (browser) |
| Answer translation endpoint (citation-marker check, cache) | implemented; end-to-end test pending a finished run with the validated model |

-- VIDHIGYA_AI_PROD database (SQLite). Registry tables are rebuilt from the research corpus; research tables are the audit log.
CREATE TABLE IF NOT EXISTS judgments (
  document_id TEXT PRIMARY KEY, case_title TEXT, case_number TEXT, court TEXT, decision_date TEXT, case_type TEXT,
  language TEXT, page_count INTEGER, file_name TEXT, source_url TEXT, translation_status TEXT);
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER, vec_row INTEGER NOT NULL, text TEXT);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS chunks_row ON chunks(vec_row);

CREATE TABLE IF NOT EXISTS research_runs (
  run_id TEXT PRIMARY KEY, created_at TEXT, question TEXT, status TEXT, stage TEXT, outcome TEXT,
  answer TEXT, citations TEXT, raw_answer TEXT, gate TEXT, config TEXT, timings TEXT, error TEXT, saved INTEGER DEFAULT 0, agent TEXT);
CREATE TABLE IF NOT EXISTS run_evidence (
  run_id TEXT, evidence_id TEXT, rank INTEGER, chunk_id TEXT, document_id TEXT, passage TEXT, score REAL,
  PRIMARY KEY (run_id, evidence_id));
CREATE TABLE IF NOT EXISTS run_claims (
  run_id TEXT, idx INTEGER, claim TEXT, cited TEXT, supported INTEGER, reason TEXT, PRIMARY KEY (run_id, idx));
CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT, ts REAL, stage TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS run_translations (
  run_id TEXT, lang TEXT, text TEXT, model TEXT, created_at TEXT, PRIMARY KEY (run_id, lang));

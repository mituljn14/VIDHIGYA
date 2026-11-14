"""Build the VIDHIGYA document registry (SQLite) from the cleaned corpus used in the research (98,509 chunks) and the
judgment metadata (5,878 judgments). Read-only on the sources. The row order of `chunks.vec_row` equals the row order of
the E5 / BGE corpus vector files (points.jsonl order), which retrieval relies on.

Usage: python build_registry.py [points.jsonl] [judgments.jsonl] [out.db]   (defaults from app.config)
"""
import json, os, sqlite3, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from app import config as C

points = sys.argv[1] if len(sys.argv) > 1 else C.POINTS_JSONL
meta = sys.argv[2] if len(sys.argv) > 2 else C.JUDGMENTS_JSONL
out = sys.argv[3] if len(sys.argv) > 3 else C.DB_PATH
os.makedirs(os.path.dirname(out), exist_ok=True)
con = sqlite3.connect(out)
con.executescript(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'schema.sql'), encoding='utf-8').read())
con.execute('DELETE FROM chunks'); con.execute('DELETE FROM judgments')
n = 0
for l in open(meta, encoding='utf-8'):
    d = json.loads(l)
    con.execute('INSERT OR REPLACE INTO judgments VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (d['document_id'], d.get('case_title'), d.get('case_number'), d.get('court'), d.get('decision_date'), d.get('case_type'),
                 d.get('language'), d.get('page_count'), d.get('file_name'), d.get('source_url'), d.get('original_or_translated_status')))
    n += 1
rows = []
for i, l in enumerate(open(points, encoding='utf-8')):
    p = json.loads(l)['payload']
    rows.append((p['chunk_id'], p['document_id'], int(p.get('chunk_index') or 0), i, (p.get('text') or '').replace('\\n', '\n')))
    if len(rows) == 5000:
        con.executemany('INSERT INTO chunks VALUES (?,?,?,?,?)', rows); rows = []
con.executemany('INSERT INTO chunks VALUES (?,?,?,?,?)', rows)
con.commit()
print('judgments', n, 'chunks', con.execute('SELECT COUNT(*) FROM chunks').fetchone()[0])

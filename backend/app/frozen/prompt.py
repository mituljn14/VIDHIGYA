"""build_prompt copied verbatim from the frozen System B script run_improved_B_29.py (structured-citation B)."""


def build_prompt(query,evidence):
    blocks=[]
    for e in evidence:
        pages="unknown" if e.get("page_start") is None else str(e.get("page_start"))+(f"–{e['page_end']}" if e.get("page_end") not in (None,e.get("page_start")) else "")
        title=e.get("judgment_title") or "not available in registry"
        blocks.append(f"[{e['evidence_id']}] document_id={e.get('document_id')} judgment_id={e.get('judgment_id')} chunk_id={e.get('chunk_id')} title={title} pages={pages}\n{e.get('original_passage','')}")
    return ("You are a Marathi legal research assistant. Answer in the language of the question. "
      "Use only the evidence passages below for case-specific facts and legal propositions. "
      "Each factual sentence must end with one or more inline evidence markers exactly like [E001]. "
      "The citations array must list exactly the evidence IDs used inline. Never invent an evidence ID. "
      "If the passages do not establish a reliable answer, give a concise Marathi abstention and an empty citations array. "
      "Return only the JSON object required by the response schema.\n\n"
      f"QUESTION:\n{query}\n\nSUPPLIED EVIDENCE:\n"+"\n\n".join(blocks)+"\n\nJSON response:")

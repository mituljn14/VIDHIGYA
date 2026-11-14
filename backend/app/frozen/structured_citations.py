"""Immutable evidence identity and constrained citation output helpers."""
from __future__ import annotations
import hashlib,json,re

def stable_evidence_key(query_id: str, evidence: dict) -> str:
    raw="|".join([query_id,str(evidence.get("document_id") or ""),str(evidence.get("chunk_id") or ""),
        hashlib.sha256((evidence.get("original_passage") or "").encode("utf-8")).hexdigest()])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def assign_evidence_ids(query_id: str, records: list[dict]) -> list[dict]:
    """Assign query-scoped IDs after retrieval/reranking/dedup; then carry objects unchanged."""
    out=[]
    for rank,source in enumerate(records,1):
        x=dict(source)
        # Rank is the already-final Phase15 evidence ordering. Don't sort or rerank afterward.
        x["evidence_id"]=f"E{rank:03d}"
        x["retrieval_rank"]=int(x.get("retrieval_rank",rank))
        x["evidence_key"]=stable_evidence_key(query_id,x)
        out.append(x)
    return out

def output_schema(evidence: list[dict]) -> dict:
    allowed=[x["evidence_id"] for x in evidence]
    return {"type":"object","properties":{"answer":{"type":"string"},
      "citations":{"type":"array","items":{"type":"string","enum":allowed},"uniqueItems":True}},
      "required":["answer","citations"],"additionalProperties":False}

def parse_structured_response(raw_response: str, evidence: list[dict]) -> dict:
    errors=[];obj=None
    try:obj=json.loads(raw_response)
    except Exception as e:errors.append(f"invalid_json:{type(e).__name__}")
    allowed={x["evidence_id"] for x in evidence}
    if not isinstance(obj,dict):
        return {"schema_valid":False,"errors":errors or ["root_not_object"],"answer":"","citations":[],"inline_ids":[],"mapping_valid":False,"citation_valid":False}
    if set(obj)!={"answer","citations"}:errors.append("keys_must_be_exactly_answer_and_citations")
    if not isinstance(obj.get("answer"),str):errors.append("answer_must_be_string")
    if not isinstance(obj.get("citations"),list) or any(not isinstance(x,str) for x in obj.get("citations",[])):errors.append("citations_must_be_string_array")
    citations=obj.get("citations",[]) if isinstance(obj.get("citations"),list) else []
    if len(set(citations))!=len(citations):errors.append("duplicate_citation_ids")
    invalid=sorted(set(citations)-allowed)
    if invalid:errors.append("citation_ids_not_in_supplied_context")
    answer=obj.get("answer") if isinstance(obj.get("answer"),str) else ""
    inline=list(dict.fromkeys(re.findall(r"\[(E\d{3})\]",answer)))
    malformed_inline=re.findall(r"\[(E[^\]]*)\]",answer)
    invalid_inline=sorted(set(inline)-allowed)
    if invalid_inline:errors.append("inline_ids_not_in_supplied_context")
    if any(x not in citations for x in inline):errors.append("inline_citation_absent_from_citations_array")
    if any(x not in inline for x in citations):errors.append("listed_citation_not_used_inline")
    mapping_valid=bool(citations) and not invalid and not invalid_inline and all(x in allowed for x in citations+inline)
    citation_valid=mapping_valid and not errors and set(citations)==set(inline)
    schema_valid=not any(e.startswith("invalid_json") or e in {"root_not_object","keys_must_be_exactly_answer_and_citations","answer_must_be_string","citations_must_be_string_array","duplicate_citation_ids"} for e in errors)
    return {"schema_valid":schema_valid,"mapping_valid":mapping_valid,"citation_valid":citation_valid,
      "answer":answer,"citations":citations,"inline_ids":inline,"malformed_inline_tokens":malformed_inline,
      "invalid_citation_ids":invalid,"invalid_inline_ids":invalid_inline,"errors":errors}

def split_claims(answer: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[।.!?])\s+|\n+",answer or "") if s.strip()]

def claim_records(answer: str, evidence: list[dict], citations: list[str]) -> list[dict]:
    by={x["evidence_id"]:x for x in evidence};out=[]
    for i,s in enumerate(split_claims(answer),1):
        ids=[x for x in re.findall(r"\[(E\d{3})\]",s) if x in by]
        # No silently assumed support: uncited claims are marked for review and mapped to no passage.
        out.append({"claim_index":i,"claim_text":s,"cited_evidence_ids":ids,
          "cited_evidence_keys":[by[x]["evidence_key"] for x in ids],
          "citation_status":"mapped" if ids and all(x in citations for x in ids) else "missing_or_unmapped",
          "verifier_status":"PENDING_MODEL_CLAIM_REVIEW","support_status":"NOT_YET_VERIFIED"})
    return out

def apply_claim_gate(answer: str, claim_reviews: list[dict]) -> dict:
    """Keep only claims the separate verifier marks SUPPORTED; abstain if none remain."""
    claims=split_claims(answer);review={int(x["claim_index"]):x for x in claim_reviews}
    kept=[];removed=[]
    for i,s in enumerate(claims,1):
        status=review.get(i,{}).get("support_status","INSUFFICIENT_EVIDENCE")
        if status=="SUPPORTED":kept.append(s)
        else:removed.append({"claim_index":i,"claim":s,"status":status})
    abstained=not kept
    final="\n".join(kept) if kept else "उपलब्ध पुराव्यातून या प्रश्नाचे उत्तर पुरेशा खात्रीने निश्चित करता येत नाही."
    ids=list(dict.fromkeys(x for c in kept for x in re.findall(r"\[(E\d{3})\]",c)))
    return {"final_answer":final,"final_citations":ids,"removed_or_qualified_claims":removed,"abstained":abstained}

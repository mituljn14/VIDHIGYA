"""Full-Marathi mode for English and mixed-script questions (2026-11-14, owner request; under test as EXP-NEW-34b).

The judgments are Marathi, so the whole agent (search, question splitting, coverage check, case/party gate, answer, claim check)
works best on a Marathi question. For a non-Marathi question:
  1. translate it ONCE into formal Marathi with gemma3:12b (same prompt and settings as the D3 translation experiment);
  2. validate: the translation must be mostly Devanagari and keep every number of the original (case numbers, sections, years);
     otherwise the original question is used unchanged (fail-safe) and the reason is recorded;
  3. the agent runs on the Marathi question;
  4. for English questions the verified answer is translated back to English (citation markers must be preserved), shown first,
     with the Marathi answer kept as the authoritative version.
Marathi questions are never touched."""
from __future__ import annotations
import json, re
from . import config as C, generation as G

DEVA = re.compile(r'[ऀ-ॿ]'); LAT = re.compile(r'[A-Za-z]')
DIG = str.maketrans('०१२३४५६७८९', '0123456789')
PROMPT = ("Rewrite the following legal research question in formal Marathi (Devanagari script), as a Marathi lawyer would write it "
          "for searching Bombay High Court judgments written in Marathi. Keep every case number, section number, date, statute name "
          "and person or party name exactly as given (transliterate names into Devanagari only if they are written in Latin script). "
          "Do not answer the question and do not add information.{g} Return only the JSON object.\n\nQUESTION:\n{q}\n\nJSON:")

# Standard Marathi legal terms as used in Bombay High Court Marathi judgments. Only the entries whose English term occurs in the
# question are given to the model (owner test 2026-11-14: "bail" was rendered as a non-word without this).
GLOSSARY = {
    'anticipatory bail': 'अटकपूर्व जामीन', 'bail': 'जामीन', 'cheating': 'फसवणूक', 'accused': 'आरोपी', 'complainant': 'फिर्यादी',
    'writ petition': 'रिट याचिका', 'petitioner': 'याचिकाकर्ता', 'respondent': 'प्रतिवादी', 'appellant': 'अपीलकर्ता',
    'second appeal': 'द्वितीय अपील', 'appeal': 'अपील', 'high court': 'उच्च न्यायालय', 'sessions court': 'सत्र न्यायालय',
    'magistrate': 'दंडाधिकारी', 'judgment': 'निकाल', 'judgement': 'निकाल', 'injunction': 'मनाई हुकूम', 'decree': 'हुकूमनामा',
    'suit': 'दावा', 'plaintiff': 'वादी', 'defendant': 'प्रतिवादी', 'evidence': 'पुरावा', 'witness': 'साक्षीदार',
    'fir': 'प्रथम खबरी अहवाल', 'police station': 'पोलीस ठाणे', 'section': 'कलम', 'indian penal code': 'भारतीय दंड संहिता',
    'code of criminal procedure': 'फौजदारी प्रक्रिया संहिता', 'civil procedure code': 'दिवाणी प्रक्रिया संहिता',
    'code of civil procedure': 'दिवाणी प्रक्रिया संहिता', 'property': 'मालमत्ता', 'partition': 'वाटप', 'possession': 'ताबा',
    'compensation': 'नुकसानभरपाई', 'maintenance': 'पोटगी', 'divorce': 'घटस्फोट', 'quashed': 'रद्द',
    'sentence': 'शिक्षा', 'acquitted': 'निर्दोष', 'convicted': 'दोषी', 'murder': 'खून', 'dowry': 'हुंडा', 'tenant': 'भाडेकरू',
    'landlord': 'घरमालक', 'gram panchayat': 'ग्रामपंचायत', 'election': 'निवडणूक', 'pension': 'निवृत्तीवेतन',
    'land acquisition': 'भूसंपादन', 'contract': 'करार'}


MATRA = re.compile(r'[ऺ-्ऀ-ःॕ-ॗॢॣ]')


def has_term(text: str, term: str) -> bool:
    """Term present allowing Marathi inflection: vowel signs ignored and the last letter of each word may change
    (e.g. जामीन -> जामिनाच्या, न्यायालय -> न्यायालयाने)."""
    t = MATRA.sub('', text)
    return all(MATRA.sub('', w)[:-1] in t for w in term.split())


def glossary_for(q: str) -> dict:
    """Glossary entries whose English term occurs in the question (longest match first; a shorter term inside it is not repeated)."""
    low, hits = ' ' + re.sub(r'[^a-z0-9]+', ' ', q.lower()) + ' ', {}
    for en in sorted(GLOSSARY, key=len, reverse=True):
        if f' {en} ' in low:
            hits[en] = GLOSSARY[en]; low = low.replace(f' {en} ', ' # ')
    return hits


def language(q: str) -> str:
    """'mr' (Devanagari letters >= 85% of letters), 'en' (<= 15%) or 'mixed'."""
    d, l = len(DEVA.findall(q)), len(LAT.findall(q))
    if d + l == 0:
        return 'mr'
    share = d / (d + l)
    return 'mr' if share >= 0.85 else ('en' if share <= 0.15 else 'mixed')


def numbers(t: str) -> set:
    return set(re.findall(r'\d+', (t or '').translate(DIG)))


def to_marathi(q: str) -> dict:
    lang = language(q)
    info = {'original': q, 'language': lang, 'marathi': None, 'used': q, 'translated': False, 'reason': None}
    if lang == 'mr' or not C.QUERY_TRANSLATE:
        info['reason'] = 'marathi question' if lang == 'mr' else 'translation disabled'
        return info
    gl = glossary_for(q)
    g = (' Use these standard Marathi legal terms: ' + '; '.join(f'{e} = {m}' for e, m in gl.items()) + '.') if gl else ''
    schema = {'type': 'object', 'properties': {'marathi_question': {'type': 'string'}}, 'required': ['marathi_question']}
    try:
        mq, absent = '', []
        for attempt in range(2):   # one retry if a required glossary term is missing from the translation
            extra = g if attempt == 0 else g + ' You MUST use: ' + ', '.join(gl[e] for e in absent) + '.'
            mq = (json.loads(G.gen(PROMPT.format(q=q, g=extra), schema, 300, 2048, 0.0).get('response') or '{}').get('marathi_question') or '').strip()
            absent = [e for e, m in gl.items() if not has_term(mq, m)]
            if not absent:
                break
    except Exception as exc:
        info['reason'] = f'translation failed ({type(exc).__name__}); original question used'
        return info
    if re.search(r'[0-9]', q) and not re.search(r'[०-९]', q):
        mq = mq.translate(DIG)   # keep numbers in the digits the user typed (case numbers, sections, years)
    info['marathi'] = mq; info['glossary'] = gl; info['glossary_missing'] = absent
    missing = numbers(q) - numbers(mq)
    if not mq or language(mq) == 'en':
        info['reason'] = 'translation not in Marathi; original question used'
    elif missing:
        info['reason'] = f'translation dropped number(s) {sorted(missing)}; original question used'
    else:
        info.update(used=mq, translated=True, reason='translated to Marathi; the agent runs on the Marathi question')
    return info


TRANSLATE = ("Translate the legal research answer below into English. Keep every citation marker such as [E001] exactly as written and "
             "in the same place. Do not add, remove, explain or soften any information; keep legal terms precise. "
             "Return only the JSON object.\n\nANSWER:\n{a}\n\nJSON response:")


def answer_to_english(answer: str) -> str | None:
    """English reading copy of the verified Marathi answer; None if the citation markers change (then only Marathi is shown)."""
    marks = lambda t: sorted(re.findall(r'\[E\d{3}\]', t or ''))
    try:
        out = json.loads(G.gen(TRANSLATE.format(a=answer), {'type': 'object', 'properties': {'translation': {'type': 'string'}},
                                                          'required': ['translation']}, 1024, 8192, 0.0).get('response') or '{}').get('translation') or ''
    except Exception:
        return None
    return out if out.strip() and marks(out) == marks(answer) else None

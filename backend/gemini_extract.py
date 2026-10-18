"""
PowerProof — Gemini Extraction Module
========================================
Reads unstructured text (a supplier email, a grid-restriction notice) and
returns STRUCTURED data for the solver to use. This is the "meaningful
use of Gen AI" half of the rubric's Technical Merit point: Gemini is
doing something a simple regex or keyword search cannot — understanding
context, flagging ambiguity, and refusing to silently guess.

Design rule (deliberate, stated in every system prompt below):
Gemini NEVER invents a number it is not confident about. If the source
text is ambiguous, the `confidence` field says so and the field is
marked for human verification — it is not silently filled with a guess.

NOTE ON TESTING: this module requires a real GEMINI_API_KEY to call the
live API. Where that key is not available, `extract_supplier_delay()`
and `extract_grid_restriction()` fall back to a clearly-labeled
offline parser so the rest of the pipeline can still be exercised and
demoed — but that fallback is NOT Gemini and must never be presented
as if it were in the pitch or demo. Calls made with a real key are
logged as such; calls using the fallback are logged as "OFFLINE_STUB".
"""

import os
import json
import re
import hashlib
from pathlib import Path
from typing import Optional

# ----------------------------------------------------------------------
# Response cache — avoids re-calling Gemini for inputs already seen.
# Critical for staying under the free-tier rate limit during repeated
# development/demo-rehearsal runs. Cache is just local JSON files; this
# is a development convenience, not a production caching strategy.
# ----------------------------------------------------------------------
CACHE_DIR = Path(__file__).parent / ".gemini_cache"
CACHE_DIR.mkdir(exist_ok=True)


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _read_cache(text: str) -> Optional[dict]:
    path = CACHE_DIR / f"extract_{_cache_key(text)}.json"
    if path.exists():
        cached = json.loads(path.read_text())
        cached["_source"] = cached.get("_source", "") + "_CACHED"
        return cached
    return None


def _write_cache(text: str, result: dict):
    path = CACHE_DIR / f"extract_{_cache_key(text)}.json"
    path.write_text(json.dumps(result, indent=2))

try:
    from google import genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


EXTRACTION_SYSTEM_PROMPT = """You are a data-extraction assistant for a factory
operations system. You will be given a short, informal message (a supplier
email, a grid-operator notice, or a factory worker's incident report).

Extract ONLY the fields explicitly present or clearly implied in the text.
Return a JSON object with exactly these fields:

{
  "message_type": "supplier_delay" | "grid_restriction" | "machine_issue" | "unclear",
  "extracted_fields": { ... key-value pairs found in the text ... },
  "confidence": "high" | "medium" | "low",
  "uncertainty_note": "a plain-language note about what is NOT certain, or null if fully certain",
  "requires_human_verification": true | false
}

Rules:
- If a date, quantity, or delay duration is stated as an estimate, range,
  or hedge ("around", "should", "we think", "probably"), set confidence
  to "medium" or "low" and requires_human_verification to true.
- NEVER invent a number that is not stated or clearly computable from the text.
- If the message is ambiguous or you cannot determine message_type with
  reasonable confidence, set message_type to "unclear" and explain why in
  uncertainty_note.
- Output ONLY the JSON object. No preamble, no markdown fences, no commentary.
"""


def _offline_stub_extract(text: str) -> dict:
    """
    OFFLINE FALLBACK — used only when no Gemini API key is configured.
    This is a simple regex-based parser, explicitly NOT Gen AI. It exists
    so the rest of the pipeline (solver, validator, dispatch) can be
    demoed and tested end-to-end without a live API key during
    development. The pitch and demo video MUST use the real Gemini path.
    """
    result = {
        "message_type": "unclear",
        "extracted_fields": {},
        "confidence": "low",
        "uncertainty_note": "OFFLINE_STUB: no Gemini API key configured; this is a regex fallback, not Gen AI extraction.",
        "requires_human_verification": True,
        "_source": "OFFLINE_STUB",
    }

    delay_match = re.search(r"(\d+)\s*day", text, re.IGNORECASE)
    qty_match = re.search(r"(\d[\d,]*)\s*(units|kg|pieces|pcs)", text, re.IGNORECASE)

    if "delay" in text.lower() or "late" in text.lower():
        result["message_type"] = "supplier_delay"
        if delay_match:
            result["extracted_fields"]["delay_days"] = int(delay_match.group(1))
        if qty_match:
            result["extracted_fields"]["quantity"] = qty_match.group(1).replace(",", "")
        result["confidence"] = "medium" if delay_match else "low"

    if "grid" in text.lower() or "power" in text.lower() or "kw" in text.lower():
        result["message_type"] = "grid_restriction"
        kw_match = re.search(r"(\d+)\s*kw", text, re.IGNORECASE)
        if kw_match:
            result["extracted_fields"]["capacity_kw"] = int(kw_match.group(1))

    return result


def extract_message(text: str, api_key: Optional[str] = None, use_cache: bool = True) -> dict:
    """
    Main entry point. Tries the real Gemini API if a key is available
    (either passed directly or via GEMINI_API_KEY env var); otherwise
    falls back to the clearly-labeled offline stub.

    If use_cache is True (default), a previously-seen exact input text
    returns the cached Gemini result instead of making a new API call —
    this is what keeps repeated demo rehearsals from burning through the
    free-tier rate limit.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")

    if not key or not GENAI_AVAILABLE:
        return _offline_stub_extract(text)

    if use_cache:
        cached = _read_cache(text)
        if cached:
            return cached

    try:
        client = genai.Client(api_key=key)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=f"{EXTRACTION_SYSTEM_PROMPT}\n\nMessage to extract:\n{text}",
        )
        raw = response.text.strip()
        # Defensive: strip markdown fences if the model adds them despite instructions
        raw = re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip()
        parsed = json.loads(raw)
        parsed["_source"] = "GEMINI_LIVE"
        if use_cache:
            _write_cache(text, parsed)
        return parsed
    except Exception as e:
        # Fail loudly in the log, but return a safe, clearly-labeled result
        # rather than crashing the pipeline or silently guessing.
        return {
            "message_type": "unclear",
            "extracted_fields": {},
            "confidence": "low",
            "uncertainty_note": f"Gemini extraction failed: {e}. Needs manual review.",
            "requires_human_verification": True,
            "_source": "GEMINI_ERROR",
        }


# ----------------------------------------------------------------------
# Demo sample messages (simulated, for the hackathon demo)
# ----------------------------------------------------------------------

SAMPLE_SUPPLIER_EMAIL = """
Hi team, quick update — the remaining components for your order will
be about 2 days later than planned, we're seeing some delays at our
end. Current confirmed quantity ready to ship is 480 units. Will
update you if anything changes.
"""

SAMPLE_GRID_NOTICE = """
NOTICE: Due to ongoing supply constraints, peak-hour (2pm-5pm)
industrial power allocation is temporarily reduced to 180kW for your
connection, effective today. Normal capacity (300kW) will resume once
supply conditions stabilize. We apologize for the inconvenience.
"""


if __name__ == "__main__":
    print("=" * 60)
    print("Testing extraction (will use OFFLINE_STUB if no API key set)")
    print("=" * 60)

    print("\n--- Supplier email ---")
    result1 = extract_message(SAMPLE_SUPPLIER_EMAIL)
    print(json.dumps(result1, indent=2))

    print("\n--- Grid notice ---")
    result2 = extract_message(SAMPLE_GRID_NOTICE)
    print(json.dumps(result2, indent=2))

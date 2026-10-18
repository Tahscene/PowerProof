"""
PowerProof — Gemini Explanation Module
=========================================
Takes the SOLVER's raw numeric output (solver.py) and turns it into a
plain-language explanation a factory manager can act on in seconds.

Critical design boundary (this is the core rubric-facing claim of the
whole project): Gemini receives the solver's numbers as READ-ONLY input
and is explicitly instructed never to recompute, adjust, or override
them. If Gemini's explanation and the solver's numbers ever disagree,
the solver's numbers are authoritative — Gemini's job is narration, not
arithmetic.
"""

import os
import json
import re
import hashlib
from pathlib import Path
from typing import Optional

# Same lightweight development cache as gemini_extract.py — avoids
# repeated API calls for the same plan during rehearsal, to stay under
# the free-tier rate limit.
CACHE_DIR = Path(__file__).parent / ".gemini_cache"
CACHE_DIR.mkdir(exist_ok=True)


def _cache_key(payload: str) -> str:
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _read_cache(payload: str) -> Optional[str]:
    path = CACHE_DIR / f"explain_{_cache_key(payload)}.txt"
    return path.read_text() if path.exists() else None


def _write_cache(payload: str, result: str):
    path = CACHE_DIR / f"explain_{_cache_key(payload)}.txt"
    path.write_text(result)

try:
    from google import genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


EXPLAIN_SYSTEM_PROMPT = """You are explaining a factory production plan to
a busy manager who has 30 seconds to decide whether to approve it.

You will be given, as JSON, the EXACT, ALREADY-COMPUTED numbers for one
plan: its cost, which hours each line runs, which orders are on-time or
at-risk, and whether it respects the power limit. These numbers come
from a mathematical solver and are ALREADY CORRECT — your job is only to
explain them in plain English, not to recompute, question, or change
any number.

Write a short explanation (3-5 sentences) covering:
1. What this plan does differently from a normal day (in plain terms).
2. Any order that is at risk, and why, stated honestly — do not soften
   or hide a genuine risk.
3. One clear reason a manager might choose this plan over the others.

Rules:
- Do NOT state any dollar amount, kWh figure, or hour number that is not
  already present in the input JSON. If you want to mention the cost,
  copy it exactly from the input.
- Do NOT claim a risk is lower than what deadline_status says.
- Write for someone who has no time to read raw numbers — plain English,
  no jargon, no bullet points, just a short paragraph.
- Output ONLY the explanation text. No preamble, no JSON, no markdown.
"""


def _offline_stub_explain(plan: dict) -> str:
    """
    OFFLINE FALLBACK — template-based explanation used only when no
    Gemini API key is configured. Explicitly NOT Gen AI; exists so the
    rest of the pipeline can be demoed without a live key during
    development. The real demo/pitch must use the Gemini path.
    """
    label = plan.get("plan_label", "This plan")
    cost = plan.get("total_cost_usd", "unknown")
    at_risk = [o for o, status in plan.get("deadline_status", {}).items() if status == "at_risk"]

    text = f"[OFFLINE_STUB — template, not Gemini] {label} costs ${cost} for the day. "
    if at_risk:
        text += f"Warning: {', '.join(at_risk)} may miss its original deadline under this plan. "
    else:
        text += "All orders are expected to meet their original deadlines. "
    text += f"Peak power limit respected: {plan.get('peak_cap_respected', 'unknown')}."
    return text


def explain_plan(plan: dict, api_key: Optional[str] = None, use_cache: bool = True) -> str:
    """
    Main entry point. Tries the real Gemini API if a key is available;
    otherwise falls back to the clearly-labeled offline template.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")

    if not key or not GENAI_AVAILABLE:
        return _offline_stub_explain(plan)

    plan_json = json.dumps(plan, sort_keys=True)
    if use_cache:
        cached = _read_cache(plan_json)
        if cached:
            return cached + "\n[cached]"

    try:
        client = genai.Client(api_key=key)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=f"{EXPLAIN_SYSTEM_PROMPT}\n\nPlan data:\n{plan_json}",
        )
        result = response.text.strip()
        if use_cache:
            _write_cache(plan_json, result)
        return result
    except Exception as e:
        return f"[GEMINI_ERROR — fell back to raw data] Explanation generation failed: {e}. Raw plan: {json.dumps(plan)}"


def answer_why_question(plan: dict, question: str, api_key: Optional[str] = None) -> str:
    """
    Handles a manager's free-text "why this plan?" or "what if...?"
    question, grounded strictly in the plan's own computed data.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")

    qa_prompt = f"""A factory manager is looking at this production plan (already
computed by a solver, numbers are correct and final):

{json.dumps(plan, indent=2)}

The manager asks: "{question}"

Answer in 2-4 plain-English sentences, using ONLY the numbers present in
the plan data above. If the question asks about something not covered
by this data (e.g. a different plan, a hypothetical not in the data),
say so honestly rather than guessing. Do not invent any number."""

    if not key or not GENAI_AVAILABLE:
        return "[OFFLINE_STUB] Live question-answering requires a Gemini API key. Example data available: " + json.dumps(plan)[:200]

    try:
        client = genai.Client(api_key=key)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=qa_prompt,
        )
        return response.text.strip()
    except Exception as e:
        return f"[GEMINI_ERROR] {e}"


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from solver import build_demo_scenario, generate_plans

    sc = build_demo_scenario()
    plans = generate_plans(sc)

    for p in plans:
        print("=" * 60)
        print(p["plan_label"])
        print("=" * 60)
        explanation = explain_plan(p)
        print(explanation)
        print()

    print("=" * 60)
    print("Sample Q&A on Plan A")
    print("=" * 60)
    answer = answer_why_question(plans[0], "Why might Order_1 be at risk?")
    print(answer)

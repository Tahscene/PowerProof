"""
Regenerates firebase-hosting/tests/fixtures/ortools_cases.json from the real
OR-Tools CP-SAT model. The JavaScript solver used by the deployed web app is
tested against these results (npm test in firebase-hosting/).

Usage:  python export_test_cases.py
"""
import json
import os

from solver import build_demo_scenario, generate_plans

OUT = os.path.join(os.path.dirname(__file__), "..", "firebase-hosting", "tests", "fixtures", "ortools_cases.json")

cases = []
for cap in (120, 150, 160, 180, 200, 230, 300):
    for delay in (0, 1, 2, 3, 4):
        sc = build_demo_scenario()
        sc.peak_cap_kw = cap
        sc.orders["Order_1"]["material_ready_hour"] = delay
        row = {"cap": cap, "delay": delay}
        for p in generate_plans(sc):
            key = p["plan_label"].split("—")[0].strip().split()[-1]
            row[key] = {"cost": p["total_cost_usd"], "status": p["deadline_status"]}
        cases.append(row)

with open(OUT, "w") as f:
    json.dump(cases, f, indent=1)
print(f"wrote {len(cases)} cases to {os.path.abspath(OUT)}")

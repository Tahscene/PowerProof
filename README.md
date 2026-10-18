# PowerProof

**A crisis copilot for factories.** When a grid operator caps your power or a supplier slips, PowerProof turns the notice into three costed production plans, lets the manager approve one, and puts the new schedule on the floor in a form every worker can use, including deaf and speech-impaired colleagues.

> Google Cloud AI Builder Cup 2026, category *Manufacturing: Intelligent Operations & Industrial Efficiency*.
> Live demo: `https://YOUR_PROJECT_ID.web.app` (replace after deploying, see [docs/SETUP.md](docs/SETUP.md)).

## The problem

When energy or supply is cut mid-shift, a manager has to decide, fast, which lines run in which hours, which orders slip, and what it costs. Workers on the floor then have to be told. Spoken announcements do not reach deaf workers, and speech-impaired workers cannot easily report a stopped machine. Most planning tools either give one rigid answer with no explanation, or let a language model do arithmetic it is not reliable at.

## What PowerProof does

1. **Crisis intake.** The manager pastes a notice (or uploads a photo of one). **Gemini** extracts the power cap, the restriction window and any material delay, with the exact words it relied on and a confidence level.
2. **Validation.** Extracted values go through deterministic checks (range, order, window). Anything implausible is dropped with a warning. The manager reviews and confirms before anything changes.
3. **Three plans.** A scheduling engine computes three genuinely different plans:
   - **Plan A, Cost Saver**: cheapest schedule. Deadlines are relaxed, so an order may be flagged *at risk*; the risk is shown, never hidden.
   - **Plan B, Deadline Protector**: every deadline met, lines finish as early as possible (higher cost).
   - **Plan C, Balanced**: the cheapest plan that still meets every deadline (the recommendation).
4. **Independent check.** A separate validator re-derives peak-cap compliance, material readiness, units produced, cost and deadline status from each schedule.
5. **Gemini explains.** For each plan Gemini writes a short explanation in English, Hindi or Bangla. Every number in its answer is checked against the solver's data; unknown numbers are flagged on screen.
6. **Manager approves.** One tap. The AI never decides.
7. **Floor screen (deaf workers).** The approved schedule appears as a colour grid of hours per line, with the restricted window marked. No reading or hearing required. Workers tap *Understood*.
8. **Report panel (speech-impaired workers).** Four large picture buttons (no material, machine down, quality problem, need help) plus a line selector. One tap reaches the manager in real time.

## Where Gemini is used, and where it is deliberately not

| Job | Who does it |
|---|---|
| Read a messy notice or a photo of one | **Gemini** (multimodal, JSON output) |
| Check the extracted numbers | deterministic code (`guards.js`) |
| Compute schedules, costs, deadlines | scheduling engine (`solver.js`), never Gemini |
| Verify the schedules | independent validator |
| Explain plans and answer "why?" in 3 languages | **Gemini**, constrained to the solver's data |
| Verify the explanation's numbers | deterministic code |
| Decide | the manager |

## Architecture

```
 Browser (Firebase Hosting, static)
 ├─ solver.js   exact scheduling search + independent validator   (no network)
 ├─ gemini.js ──► Firebase AI Logic ──► Gemini Developer API       (App Check enforced)
 ├─ guards.js   extraction sanitiser + number verifier             (no network)
 └─ sync.js   ──► Cloud Firestore   pp_state/current, pp_events    (real-time across devices)
```
There is no server to run and no API key in this repository. Firebase AI Logic holds the Gemini credentials; the browser proves it is the real app with **Firebase App Check** (reCAPTCHA Enterprise). Everything runs on the free Spark plan.

## The scheduling engine

`firebase-hosting/public/js/solver.js` is a JavaScript port of the CP-SAT model in `backend/solver.py`. The search is exact: each line chooses the hours it runs, the peak-hour power cap couples the lines, and a branch-and-bound search finds the optimum for each plan's objective. It cannot run OR-Tools in the browser, so the port is **tested against the real OR-Tools model** (below).

## Data (simulated)

There is no public dataset that combines tariffs, machine capacity and order deadlines for a factory, so the demo uses a **simulated** factory. It is labelled as such in the interface.

| Parameter | Value |
|---|---|
| Lines | Line A 90 kW / 120 units per h; Line B 70 kW / 95; Line C 60 kW / 80 |
| Orders | Order 1: 480 units, due slot 7; Order 2: 650 units, due slot 9; Order 3: 500 units, due slot 9 |
| Day | 10 one-hour slots, 09:00 to 19:00 |
| Tariff | $0.13 per kWh off-peak, $0.32 per kWh in the restricted window (illustrative, not taken from a utility) |
| Default crisis | 180 kW cap from 14:00 to 17:00; Order 1 material 3 hours late |

All of these can be changed in the Crisis Intake form or in `solver.js`; the engine is not fitted to one scenario.

## Tests (what is actually verified)

```bash
cd firebase-hosting
npm install
npm run test:all
```
| Test | What it proves |
|---|---|
| `solver.test.mjs` | Costs of Plan A and Plan C match the **real OR-Tools CP-SAT** model on 35 scenarios (fixtures generated by `backend/export_test_cases.py`); 400 random scenarios: every feasible plan passes the validator and A ≤ C ≤ B in cost; a tampered plan is rejected; impossible caps give "no feasible plan", not a crash |
| `guards.test.mjs` | Invented numbers are caught (including Bangla and Hindi digits); out-of-range extractions are rejected |
| `i18n.test.mjs` | Every UI string exists in English, Hindi and Bangla with matching placeholders |
| `dom.smoke.mjs` | The full manager, floor screen, worker report, language and reset flow runs in a simulated browser |
| `dom.gemini.test.mjs` | The Gemini path (extract, confirm, re-plan, explain, verify) with a fake model that deliberately invents a number, which is flagged |

## Security and data handling

- No credentials in the repository. `firebase-config.js` holds public identifiers only.
- Gemini is reachable only through Firebase AI Logic with App Check enforced.
- Firestore rules (`firestore.rules`) allow only two collections, shape-check writes, and make events append-only. There is no sign-in, so they are demo-grade: do not store anything sensitive.

## Limitations (honest)

- All factory data is simulated. Nothing has been validated against a real factory's ERP or SCADA data.
- The floor screen and report panel were **not user-tested** with deaf or speech-impaired workers. They follow accessibility principles (no audio dependence, large targets, colour plus shape plus position) but need real user testing before any deployment.
- The deployed app uses the JavaScript port. `backend/` (OR-Tools and FastAPI) is a reference implementation and test oracle, not part of the live deployment.
- Gemini runs on a free tier with rate limits; answers are cached in the browser to protect the quota. The latency shown in the Crisis Intake panel is measured live in the browser (or marked "from cache").
- One factory, one day, one order per line. No multi-site planning and no prediction of future crises.
- Re-planning after a worker report is not automatic: reports are shown to the manager, who can re-run the intake.
- The Hindi and Bangla translations were written for this project and have not been reviewed by native-speaking industrial staff.

## Repository layout

```
firebase-hosting/       deployable app (Firebase Hosting + Firestore rules) and its tests
  public/               index.html, css/, js/ (solver, gemini, guards, sync, i18n, charts, app)
  tests/                unit, cross-check and simulated-browser tests
backend/                reference OR-Tools model (solver.py) and fixture exporter
docs/SETUP.md           step-by-step Firebase setup
```

## Team

Noor-E Arafin Rafi (Team Leader), Tahsin Shuborna, Ra.One.

MIT License.

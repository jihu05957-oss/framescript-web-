# MATCHSCOPE PRO — Data/research operating notes (2026-11)
This project is a **free-source, evidence-based match research application**, not a licensed professional scouting feed or a proven betting model.

## Live interface
Public: https://matchscope-pro-analytics.onrender.com
All sports listed in \`leagues.js\` are queried for a chosen Korea-local date. Match listings from ESPN and TheSportsDB are merged, with a KBL website endpoint and historical CC0 international data where available. Source coverage is explicitly incomplete.

## Full-day job
After a user searches for a day in the browser, the site calls:
- \`GET /api/batch/start?date=YYYY-MM-DD\`
- \`GET /api/batch/status?date=YYYY-MM-DD\`
- \`GET /api/analysis?date=YYYY-MM-DD&id=...\`

These APIs start shared research with a bounded concurrency of 2 and reuse results for 20 minutes. Jobs and results are **in-memory, not durable**. They stop when the free Render instance is suspended/restarted. They are not an always-on, guaranteed scheduler. The work queue tries every discovered fixture (up to 220/day); it does not prove every real-world fixture was discovered.

## Deep report
- Confirmed schedule timing, previous/next match (only when present in collected records), potential short rest and fixture congestion
- Injury status (only from supplied ESPN sources), distinguishing evidence of team leaders from unverified starting roles
- Announced starters for live/finished matches when listed; do not claim future starters unless verified
- Related ESPN headlines with source links, not professional opinions without actual article research
- Available sportsbook reference lines, never claimed complete or current
- Reasoned upset *conditions* from verified events, not calibrated numerical injury/rotation effects
- Missing/unverified categories visibly listed

## Model integrity
Statistical score predictions require recent matches for both teams, and national soccer additionally requires historical Elo evidence. When missing, probability is withheld instead of a fabricated home win. The win probabilities that are displayed are **uncalibrated**. Injury news, next-match priority, tactical stylistics, player minutes and market consensus currently are **not numerically incorporated** into predictions without calibrated validated input data. Free API access and scraping are not equivalent to licensed, complete professional data. Do not market predictions as guaranteed or validated.

## Production requirements before promising full professional accuracy
1. Reliable, properly licensed fixtures, player status, starters, appearances/minutes and formation feeds for *each supported league*; separate official injury facts from speculation.
2. Source origin, fetched timestamp, content validity and updates for each fact.
3. Persistent store, durable background queue/scheduler, request budgets and provider error/rate-limit metrics.
4. Independent pregame backtests, Brier/log-loss and calibration by league; sensitivity and ablation tests for injury/rotation adjustments.
5. Independently sourced overseas analyst reports and official manager interviews, plus live odds movement under terms-compatible APIs.
6. Documented costs and user approval before purchasing any recurring data/API plans.

## Tests
\`cd matchscope-pro && npm test\`

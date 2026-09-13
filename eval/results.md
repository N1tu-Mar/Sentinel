# Eval results

Run at 2026-09-13T19:08:44.314Z against **Stripe test mode + local sandbox (Salesforce, Gmail, Slack)**. Each scenario: reset → seed → run agent → assert provider state.

| Metric | Value |
| --- | --- |
| Task success rate | 100% (7/7) |
| Decision accuracy | 100% |
| False-action rate | 0% |
| Constraint-violation rate | 0% |
| Recovery rate | 100% (1 chaos scenarios) |
| State consistency | 100% |
| Mean provider calls | 31 |
| Mean wall time | 44.1 s |

| Scenario | Expected | Got | Chaos | Submit attempts | Provider calls | Result |
| --- | --- | --- | --- | --- | --- | --- |
| scenario-01 | FIGHT | FIGHT | none | 1 | 26 | pass |
| scenario-02 | FIGHT | FIGHT | none | 1 | 26 | pass |
| scenario-03 | ACCEPT | ACCEPT | none | 0 | 29 | pass |
| scenario-04 | ACCEPT | ACCEPT | none | 0 | 44 | pass |
| scenario-05 | FIGHT_AND_FLAG | FIGHT_AND_FLAG | none | 1 | 38 | pass |
| scenario-06 | ASK_HUMAN | ASK_HUMAN | none | 0 | 25 | pass |
| scenario-07 | FIGHT | FIGHT | drop_submit_once | 2 | 32 | pass |
| scenario-08 | EXPIRED_OR_BLOCKED | - | none | 0 | 0 | skipped: the Stripe backend could not seed a past evidence deadline |

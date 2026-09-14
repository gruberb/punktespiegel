# Bundesliga recommender audit — 2026/27

## Verdict

The optimization layer passes the historical proof check for Interactive. For
every completed Bundesliga season in the repository, HiGHS found a feasible
22-player roster and certified a zero MIP gap. Budget is treated as a ceiling,
not a spending target; a synthetic regression test also proves that a €11.0m
higher-scoring roster beats an available €42.5m lower-scoring roster.

The forecasting layer is **not winner-proven**. On the later 2025/26 holdout,
the safeguarded Interactive recommendation scored 2,061 points versus the
user-supplied winning score of 2,914. The CatBoost challenger scored 1,826 and
was therefore rejected in favor of the stable five-season baseline. The result
is useful evidence that the fallback gate works, but it is not evidence that
the current forecast can reproduce the winner.

Classic is constraint-checked and scored with exact automatic reserve
activation. A global full-player-pool Classic hindsight optimum is not claimed:
the starter-dependent reserve activation makes that proof substantially harder,
and the full model did not close a sufficiently small bound.

## Historical Interactive optimizer proof

“Official upper bound” applies only the official budget, roster and formation
constraints. “Insured/diversified” additionally requires all three goalkeepers
from one club and no more than three field players from one club.

| Season | Official upper bound | Insured/diversified | Strategy cost | Supplied winner | Strategic bound vs winner | Certified gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022/23 | 3,597 | 3,558 | 39 | — | — | 0.0% |
| 2023/24 | 3,862 | 3,757 | 105 | — | — | 0.0% |
| 2024/25 | 3,644 | 3,617 | 27 | 2,511 | +1,106 | 0.0% |
| 2025/26 | 3,792 | 3,721 | 71 | 2,914 | +807 | 0.0% |

These are hindsight upper bounds: the solver receives realized player points
and may choose the best valid XI from its fixed roster each matchday. They prove
the optimizer and its constraints, not preseason prediction skill. Historical
price, `active` and `selectable` fields are not archived decision-time snapshots,
so the backtest remains experimental with respect to leakage.

## Strategy decisions

- Winter transfers are excluded by default for both modes.
- Interactive uses a same-club three-goalkeeper block as insurance.
- Interactive caps field players at three per club. This is a risk preference,
  not an official kicker rule.
- The Interactive bench receives a 0.15 option weight selected on 2024/25. This
  lets the optimization trade a stars-and-fillers roster against broader depth.
- Historical starts, substitute appearances and DNPs feed injury/rotation risk.
  There is no reliable historical European-fixture feed, so no arbitrary blanket
  penalty is applied to clubs playing internationally.

## Recommended Interactive team

Budget: **€42.4m / €42.5m**. Initial formation: **4-3-3**. Projected starting
points: **1,689**. The production solver finished inside the configured 0.5%
gap threshold. The projection is an expectation, not a winning-score claim.

| Position | Role | Player | Club | Price |
| --- | --- | --- | --- | ---: |
| GK | Start | Moritz Nicolas | Borussia Mönchengladbach | €3.0m |
| GK | Reserve | Jan Olschowsky | Borussia Mönchengladbach | €0.5m |
| GK | Reserve | Tobias Sippel | Borussia Mönchengladbach | €0.5m |
| DEF | Start | Matthias Ginter | SC Freiburg | €4.2m |
| DEF | Start | Vladimir Coufal | TSG Hoffenheim | €3.2m |
| DEF | Start | Willi Orban | RB Leipzig | €3.0m |
| DEF | Start | Ozan Kabak | TSG Hoffenheim | €2.3m |
| DEF | Reserve | David Fürst | 1. FC Köln | €0.5m |
| DEF | Reserve | Karl Steinmann | SC Freiburg | €0.5m |
| DEF | Reserve | Steve Noode | FC Schalke 04 | €0.5m |
| MID | Start | Jamal Musiala | Bayern München | €4.5m |
| MID | Start | Wouter Burger | TSG Hoffenheim | €3.4m |
| MID | Start | Niklas Beste | SC Freiburg | €2.4m |
| MID | Reserve | Benno Kaltefleiter | RB Leipzig | €0.5m |
| MID | Reserve | Ertugrul Yigit | VfB Stuttgart | €0.5m |
| MID | Reserve | Luca Vozar | FC Schalke 04 | €0.5m |
| MID | Reserve | Tim Blaszczak | 1. FC Union Berlin | €0.5m |
| FWD | Start | Serhou Guirassy | Borussia Dortmund | €5.0m |
| FWD | Start | Jonathan Burkardt | Eintracht Frankfurt | €4.0m |
| FWD | Start | Michael Gregoritsch | FC Augsburg | €1.8m |
| FWD | Reserve | Albert Millgramm | SC Paderborn 07 | €0.5m |
| FWD | Reserve | Paul Erevbenagie | Werder Bremen | €0.6m |

## Recommended Classic team

Budget: **€30.0m / €30.0m**. Fixed formation: **4-4-2**. Projected starting
points including the modeled reserve mechanism: **1,483**.

| Position | Role | Player | Club | Price |
| --- | --- | --- | --- | ---: |
| GK | Start | Moritz Nicolas | Borussia Mönchengladbach | €3.0m |
| GK | Reserve | Marius Funk | VfB Stuttgart | €0.5m |
| DEF | Start | Vladimir Coufal | TSG Hoffenheim | €3.2m |
| DEF | Start | Ozan Kabak | TSG Hoffenheim | €2.3m |
| DEF | Start | Chrislain Matsima | FC Augsburg | €2.3m |
| DEF | Start | Amos Pieper | Werder Bremen | €1.8m |
| DEF | Reserve | Alessio Castro-Montes | 1. FC Köln | €1.4m |
| MID | Start | Vincenzo Grifo | SC Freiburg | €3.0m |
| MID | Start | Niklas Beste | SC Freiburg | €2.4m |
| MID | Start | Anton Kade | FC Augsburg | €2.4m |
| MID | Start | Adil Aouchiche | FC Schalke 04 | €2.3m |
| MID | Reserve | Ertugrul Yigit | VfB Stuttgart | €0.5m |
| FWD | Start | Sheraldo Becker | 1. FSV Mainz 05 | €2.6m |
| FWD | Start | Michael Gregoritsch | FC Augsburg | €1.8m |
| FWD | Reserve | Albert Millgramm | SC Paderborn 07 | €0.5m |

The Classic rolling folds beat the stable v1 baseline in two of three seasons:
+220 (2023/24), -208 (2024/25), and +185 (2025/26), for +197 in aggregate.
The historical 2023/24 fold uses the then-valid 2/4/6/3 roster and 3-5-2; later
folds use 2/5/5/3 and 4-4-2.

## Freshness boundary

The recommendation uses the repository's 2026/27 market snapshot from 11 August
2026 and the current-role/medical snapshot from 13 August 2026. Re-run the signal
import immediately before locking either team, especially to catch late injuries,
sales, loans and hierarchy changes.

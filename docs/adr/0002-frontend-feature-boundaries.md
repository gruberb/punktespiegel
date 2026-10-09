# React feature boundaries

Date: 2026-10-09. Status: implemented.

The frontend has one 2,532-line component module and one 1,048-line data
adapter. Navigation, requests, calculations, and presentation are difficult to
trace independently. Contributors need to find the owner of a screen and follow
its input through to the rendered result.

Adopt the feature organization and one-way dependencies described in
[Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md):
`app` composes features, features consume shared modules, and shared modules
never import features or the app. Features do not import other features.
Shared football presentation belongs in `components`; shared snapshot loading
and calculations belong in `lib/data`. Keep direct imports and colocated tests.

Preserve the existing fun-ui integration, CSS, URLs, static hosting, data
contracts, and football calculations. Existing uncommitted frontend changes
are the migration baseline. No generator changes are needed.

Keep React state and the existing snapshot cache. Adding a router, query library,
or global store during the move would expand the behavioural migration without
solving the immediate ownership problem. Reconsider these dependencies when
browser-history requirements, mutable server data, or shared editable state
require them. The trade-off is that the small navigation and request mechanisms
remain ours to maintain and test.

Example: selecting a player passes its ID to the app's navigation callback;
the app resolves the league and season, then the player feature loads its view
model from the shared data adapter and renders it. A failed required request
shows an error; an obsolete request must not overwrite a newer selection.

Verification: existing calculation and route tests, import-boundary checks,
request failure/cancellation coverage, TypeScript, production build, and browser
checks of list/detail navigation and season changes. Document actual results
after the migration.

## Verification and consequences

`app.tsx` now contains 74 lines of composition. Navigation and page metadata have
separate hooks; seven feature directories own the screens. The data adapter is
split into snapshot loading, stored contracts, scoring, and view-model modules.
The shared resource hook prevents cancelled or obsolete requests from publishing
data, errors, or loading-state changes. Initial season resolution now also keeps
the match ID in direct URLs, fixing a bug found during browser verification.

On 2026-10-09, all 52 unit tests and two architecture checks passed, as did
TypeScript and the production build. A one-off comparison against the saved
pre-refactor adapter passed 118 cases across three leagues and three seasons,
including missing IDs and invalid rounds. The comparison used the repository's
JSON files and did not contact upstream data providers.

Browser checks covered standings, player search, player details, a historical
season change, player-to-team navigation, the internal back button, manager
rankings, matchday results, match reports, a missing-match error, and direct match
links surviving reload. No browser console errors were reported during the
successful navigation checks. Existing CSS was preserved byte for byte.

No new package dependency was added. The existing local `file:../../fun-ui`
dependency still requires a sibling checkout for clean installation. Full CI,
deployment, and release were not run as part of this frontend migration.

### Release preparation, 2026-10-09

For v1.29.0, the local fun-ui dependency was replaced with the published commit
`05281f2f8fea8dfc9b8b1cbafb6899994e6192c5`. Clean installs no longer require a
sibling checkout. The Docker builder installs Git so npm can retrieve that
dependency and run its library build.

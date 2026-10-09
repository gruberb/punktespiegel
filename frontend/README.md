# Frontend entwickeln

React und TypeScript mit Vite; Daten kommen aus `public/data`.
Beginne mit [Struktur und Datenfluss](../docs/frontend-architecture.md).

Vom Repository-Stamm:

```bash
npm ci
npm run dev
npm test --workspace frontend
npm run typecheck
npm run build
```

`@gruberb/fun-ui` ist auf einen veröffentlichten Git-Commit festgelegt.
`npm ci` benötigt Git und baut die Bibliothek über deren `prepare`-Skript.
Ein lokales Nachbarprojekt ist nicht erforderlich. `main.tsx` lädt die Styles;
Vite dedupliziert React auch bei einer lokal verlinkten Bibliothek.

`src/app/app.tsx` verbindet die Features. Neue Ansichten gehören nach
`src/features`, gemeinsame Datenberechnungen nach `src/lib/data`. Die Tests
verhindern gegenseitige Feature-Importe und Importzyklen.

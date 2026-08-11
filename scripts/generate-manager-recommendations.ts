import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recommendManagerSquad } from "../frontend/src/manager-model.ts";
import type { ManagerSeason } from "../frontend/src/manager-model.ts";
import type { Catalog, ManagerMode, ManagerRecommendation } from "../frontend/src/types.ts";

type StaticCatalog = Catalog & { schemaVersion: number; generatedAt: string };
type RecommendationArtifact = {
  schemaVersion: 1;
  modelVersion: 1;
  generatedAt: string;
  source: {
    catalogGeneratedAt: string;
    seasonGeneratedAt: string;
    seasonId: string;
  };
  recommendation: ManagerRecommendation;
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(projectRoot, "frontend/public/data");
const recommendationDirectory = resolve(dataDirectory, "recommendations");
const catalog = JSON.parse(readFileSync(resolve(dataDirectory, "catalog.json"), "utf8")) as StaticCatalog;
const modes: ManagerMode[] = ["classic", "interactive"];

mkdirSync(recommendationDirectory, { recursive: true });

for (const league of catalog.leagues) {
  const latestSeason = catalog.seasons
    .filter((season) => season.leagueCode === league.code)
    .sort((left, right) => right.startYear - left.startYear)[0];
  if (!latestSeason) throw new Error(`Keine Saison für Liga ${league.code} gefunden.`);
  const seasonPath = resolve(dataDirectory, `seasons/${latestSeason.id}.json`);
  const season = JSON.parse(readFileSync(seasonPath, "utf8")) as ManagerSeason & { schemaVersion: number };
  if (season.schemaVersion !== 2) throw new Error(`${latestSeason.id} verwendet einen unbekannten Datenvertrag.`);

  for (const mode of modes) {
    const recommendation = recommendManagerSquad(catalog, season, mode);
    const artifact: RecommendationArtifact = {
      schemaVersion: 1,
      modelVersion: 1,
      generatedAt: season.generatedAt,
      source: {
        catalogGeneratedAt: catalog.generatedAt,
        seasonGeneratedAt: season.generatedAt,
        seasonId: latestSeason.id,
      },
      recommendation,
    };
    const outputPath = resolve(recommendationDirectory, `${latestSeason.id}-${mode}.json`);
    writeFileSync(outputPath, `${JSON.stringify(artifact)}\n`);
    process.stdout.write(`${latestSeason.id}-${mode}: ${recommendation.projectedStartingPoints} Punkte\n`);
  }
}

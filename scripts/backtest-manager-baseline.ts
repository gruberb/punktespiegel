import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { managerCandidateProjections, recommendManagerSquad } from "./manager-model.ts";
import type { ManagerSeason } from "./manager-model.ts";
import type { Catalog } from "../frontend/src/types.ts";
import type { ManagerMode } from "./manager-types.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(projectRoot, "frontend/public/data");
const catalog = JSON.parse(readFileSync(resolve(dataDirectory, "catalog.json"), "utf8")) as Catalog;
const holdoutYear = Number(process.argv[2]);
if (!Number.isInteger(holdoutYear)) throw new Error("Holdout-Startjahr fehlt.");
const mode = (process.argv[3] ?? "interactive") as ManagerMode;
if (mode !== "classic" && mode !== "interactive") throw new Error("Unbekannter Manager-Modus.");

const trainingCatalog: Catalog = {
  ...catalog,
  seasons: catalog.seasons.filter((season) => season.startYear < holdoutYear),
};
const result: Record<string, {
  projectedPoints: number;
  realizedPoints: number;
  playerProjections: Record<string, number>;
  playerAvailability: Record<string, number>;
  roster: { id: string; position: string; role: string }[];
}> = {};
for (const league of catalog.leagues) {
  const season = JSON.parse(readFileSync(resolve(dataDirectory, `seasons/se-k${league.code}${holdoutYear}.json`), "utf8")) as ManagerSeason;
  const recommendation = recommendManagerSquad(trainingCatalog, season, mode);
  const candidateProjections = managerCandidateProjections(trainingCatalog, season, mode);
  const starters = new Set(recommendation.players.filter((player) => player.role === "start").map((player) => player.id));
  const realizedPoints = season.scores.reduce((sum, score) => sum + (starters.has(score.playerId) ? score.totalPoints : 0), 0);
  result[league.code] = {
    projectedPoints: recommendation.projectedStartingPoints,
    realizedPoints,
    playerProjections: Object.fromEntries(
      candidateProjections.map((player) => [player.id, player.projectedPoints]),
    ),
    playerAvailability: Object.fromEntries(
      candidateProjections.map((player) => [player.id, player.projectedAvailability]),
    ),
    roster: recommendation.players.map((player) => ({ id: player.id, position: player.position, role: player.role })),
  };
}
process.stdout.write(JSON.stringify(result));

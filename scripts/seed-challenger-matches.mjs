import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonMatchRepository } from "../server/src/matchData/jsonMatchRepository.js";
import { RiotHttpClient } from "../server/src/riotApi/riotHttpClient.js";
import { seedChallengerMatches } from "../server/src/riotApi/riotChallengerSeeder.js";
import { normalizePlatform } from "../server/src/riotApi/riotRouting.js";
import { RiotTftClient } from "../server/src/riotApi/riotTftClient.js";
import { loadProjectEnv } from "./lib/project-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CHALLENGER_PLAYERS = 10;
export const DEFAULT_MATCHES_PER_PLAYER = 10;
export const MAX_CHALLENGER_PLAYERS = 25;
export const MAX_MATCHES_PER_PLAYER = 20;

function usage() {
  return "Usage: npm run seed:challenger-matches -- --platform euw1 [--players 10] [--matches-per-player 10]";
}

export function parseChallengerSeedArgs(argv = []) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(usage());
    const key = name.slice(2);
    if (!["platform", "players", "matches-per-player"].includes(key) || values[key] !== undefined) {
      throw new Error(usage());
    }
    values[key] = value;
  }

  const platform = normalizePlatform(values.platform);
  const players = Number(values.players ?? DEFAULT_CHALLENGER_PLAYERS);
  const matchesPerPlayer = Number(values["matches-per-player"] ?? DEFAULT_MATCHES_PER_PLAYER);
  if (!Number.isInteger(players) || players < 1 || players > MAX_CHALLENGER_PLAYERS) {
    throw new Error(`--players must be an integer from 1 to ${MAX_CHALLENGER_PLAYERS}.`);
  }
  if (!Number.isInteger(matchesPerPlayer) || matchesPerPlayer < 1 || matchesPerPlayer > MAX_MATCHES_PER_PLAYER) {
    throw new Error(`--matches-per-player must be an integer from 1 to ${MAX_MATCHES_PER_PLAYER}.`);
  }
  return { platform, players, matchesPerPlayer };
}

function progressReporter(output) {
  return (event) => {
    if (event.type === "league") output.log(`Challenger entries found: ${event.entriesFound}`);
    else if (event.type === "selection") output.log(`Players selected: ${event.playersSelected}`);
    else if (event.type === "player-resolution") output.log(`Resolving player ${event.current}/${event.total}`);
    else if (event.type === "player-resolution-failed") output.error(`Player ${event.current} could not be resolved.`);
    else if (event.type === "match-ids-request") output.log(`Requesting ${event.requested} match IDs for player ${event.current}`);
    else if (event.type === "match-ids-failed") output.error(`Match IDs for player ${event.current} could not be fetched.`);
    else if (event.type === "match-fetch") output.log(`Fetching unique match ${event.current}/${event.total}`);
    else if (event.type === "match-fetch-failed") output.error(`Match fetch failed: ${event.matchId}`);
  };
}

export async function runChallengerSeedCli({
  argv = process.argv.slice(2),
  env = process.env,
  output = console,
  fetchImpl = globalThis.fetch,
  sleep,
  random,
  loadEnv = loadProjectEnv,
} = {}) {
  loadEnv(env);
  const options = parseChallengerSeedArgs(argv);
  const apiKey = String(env.RIOT_API_KEY || "").trim();
  if (!apiKey) throw new Error("RIOT_API_KEY is required.");

  const repositoryPath = env.TFT_MATCH_DATA_PATH || path.join(projectRoot, "server/data/importedMatches.json");
  const [champions, traits] = await Promise.all([
    fs.readFile(path.join(projectRoot, "server/data/champions.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(projectRoot, "server/data/traits.json"), "utf8").then(JSON.parse),
  ]);
  const httpClient = new RiotHttpClient({ apiKey, fetchImpl, ...(sleep ? { sleep } : {}), ...(random ? { random } : {}) });
  const client = new RiotTftClient({ httpClient, platform: options.platform });
  const result = await seedChallengerMatches({
    client,
    repository: new JsonMatchRepository(repositoryPath),
    champions,
    traits,
    playerCount: options.players,
    matchesPerPlayer: options.matchesPerPlayer,
    onProgress: progressReporter(output),
  });

  for (const [label, key] of [
    ["Match IDs requested per player", "matchIdsRequestedPerPlayer"],
    ["Unique match IDs discovered", "uniqueMatchIdsDiscovered"],
    ["Duplicate match IDs discovered before fetching", "duplicateMatchIdsDiscovered"],
    ["Matches fetched", "matchesFetched"],
    ["Matches imported", "matchesImported"],
    ["Repository duplicates", "repositoryDuplicates"],
    ["Failed player resolutions", "failedPlayerResolutions"],
    ["Failed match ID requests", "failedMatchIdRequests"],
    ["Failed match fetches", "failedMatchFetches"],
    ["Final repository total", "finalRepositoryTotal"],
    ["Total participant-board samples available", "participantBoardSamples"],
  ]) output.log(`${label}: ${result[key]}`);
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runChallengerSeedCli().catch((error) => {
    console.error(`Challenger match seed failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

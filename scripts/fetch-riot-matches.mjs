import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonMatchRepository } from "../server/src/matchData/jsonMatchRepository.js";
import { RiotHttpClient } from "../server/src/riotApi/riotHttpClient.js";
import { ingestRecentRiotMatches } from "../server/src/riotApi/riotMatchIngestion.js";
import { normalizePlatform } from "../server/src/riotApi/riotRouting.js";
import { RiotTftClient } from "../server/src/riotApi/riotTftClient.js";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
export const DEFAULT_MATCH_COUNT = 20;
export const MAX_MATCH_COUNT = 50;

function usage() {
  return [
    "Usage:",
    '  npm run fetch:riot-matches -- --game-name "Name" --tag-line "TAG" --platform euw1 [--count 20] [--start 0]',
    "",
    `Count defaults to ${DEFAULT_MATCH_COUNT} and may not exceed ${MAX_MATCH_COUNT}.`,
  ].join("\n");
}

function readOption(argv, index) {
  const argument = argv[index];
  const equalsIndex = argument.indexOf("=");

  if (equalsIndex > 2) {
    return {
      name: argument.slice(2, equalsIndex),
      value: argument.slice(equalsIndex + 1),
      consumed: 1,
    };
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${argument}.\n${usage()}`);
  }

  return { name: argument.slice(2), value, consumed: 2 };
}

export function parseRiotFetchArgs(argv = []) {
  const values = {};

  for (let index = 0; index < argv.length; ) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}.\n${usage()}`);
    }

    const option = readOption(argv, index);
    if (![
      "game-name",
      "tag-line",
      "platform",
      "count",
      "start",
    ].includes(option.name)) {
      throw new Error(`Unknown option: --${option.name}.\n${usage()}`);
    }
    if (values[option.name] !== undefined) {
      throw new Error(`Option --${option.name} was provided more than once.`);
    }
    values[option.name] = option.value;
    index += option.consumed;
  }

  const gameName = String(values["game-name"] || "").trim();
  const tagLine = String(values["tag-line"] || "").trim();
  const platformValue = String(values.platform || "").trim();

  if (!gameName) throw new Error(`--game-name is required.\n${usage()}`);
  if (!tagLine) throw new Error(`--tag-line is required.\n${usage()}`);
  if (!platformValue) throw new Error(`--platform is required.\n${usage()}`);

  const count = Number(values.count ?? DEFAULT_MATCH_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > MAX_MATCH_COUNT) {
    throw new Error(
      `--count must be an integer from 1 to ${MAX_MATCH_COUNT}.`,
    );
  }

  const start = Number(values.start ?? 0);
  if (!Number.isInteger(start) || start < 0) {
    throw new Error("--start must be a non-negative integer.");
  }

  return {
    help: false,
    gameName,
    tagLine,
    platform: normalizePlatform(platformValue),
    count,
    start,
  };
}

function progressReporter(output) {
  return (event) => {
    if (event.type === "player-resolved") {
      const { account, platform, regionalRoute } = event.player;
      output.log(
        `Player resolved: ${account.gameName}#${account.tagLine} (${platform} / ${regionalRoute}, PUUID ${account.puuid.slice(0, 8)}...)`,
      );
    } else if (event.type === "match-ids") {
      output.log(`Match IDs found: ${event.matchIds.length}`);
    } else if (event.type === "match-start") {
      output.log(
        `Fetching match ${event.current}/${event.total}: ${event.matchId}`,
      );
    } else if (event.type === "match-failed") {
      output.error(
        `Failed match ${event.matchId}: ${event.error.message || "request failed"}`,
      );
    }
  };
}

export async function runRiotFetchCli({
  argv = process.argv.slice(2),
  env = process.env,
  output = console,
  fetchImpl = globalThis.fetch,
  sleep,
  random,
  repository: suppliedRepository,
} = {}) {
  const options = parseRiotFetchArgs(argv);
  if (options.help) {
    output.log(usage());
    return { help: true };
  }

  const apiKey = String(env.RIOT_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "RIOT_API_KEY is required. Set it in your environment before running this command.",
    );
  }

  const [champions, traits] = await Promise.all([
    fs
      .readFile(path.join(projectRoot, "server/data/champions.json"), "utf8")
      .then(JSON.parse),
    fs
      .readFile(path.join(projectRoot, "server/data/traits.json"), "utf8")
      .then(JSON.parse),
  ]);
  const repository =
    suppliedRepository ||
    new JsonMatchRepository(
      env.TFT_MATCH_DATA_PATH ||
        path.join(projectRoot, "server/data/importedMatches.json"),
    );
  const httpClient = new RiotHttpClient({
    apiKey,
    fetchImpl,
    ...(sleep ? { sleep } : {}),
    ...(random ? { random } : {}),
  });
  const client = new RiotTftClient({
    httpClient,
    platform: options.platform,
  });
  const result = await ingestRecentRiotMatches({
    client,
    repository,
    champions,
    traits,
    gameName: options.gameName,
    tagLine: options.tagLine,
    start: options.start,
    count: options.count,
    onProgress: progressReporter(output),
  });

  output.log(`Imported count: ${result.importedCount}`);
  output.log(`Duplicate count: ${result.duplicateCount}`);
  output.log(`Failed count: ${result.failedCount}`);
  output.log(`Final repository total: ${result.totalMatches}`);
  return result;
}

if (path.resolve(process.argv[1] || "") === __filename) {
  runRiotFetchCli().catch((error) => {
    console.error(`Riot match fetch failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}


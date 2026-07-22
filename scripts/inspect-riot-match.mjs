import path from "node:path";
import { fileURLToPath } from "node:url";
import { RiotHttpClient } from "../server/src/riotApi/riotHttpClient.js";
import { normalizePlatform } from "../server/src/riotApi/riotRouting.js";
import { RiotTftClient } from "../server/src/riotApi/riotTftClient.js";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return "Usage: npm run inspect:riot-match -- --match-id EUW1_123 --platform euw1";
}

export function parseInspectArgs(argv = []) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--match-id", "--platform"].includes(name) || !value) {
      throw new Error(usage());
    }
    values[name] = value;
  }

  const matchId = String(values["--match-id"] || "").trim();
  const platform = String(values["--platform"] || "").trim();
  if (!matchId || !platform) throw new Error(usage());
  return { matchId, platform: normalizePlatform(platform) };
}

export function summarizeRawMatch(payload) {
  const info = payload?.info || {};
  const participant = Array.isArray(info.participants)
    ? info.participants[0] || {}
    : {};
  const safeParticipantKeys = Object.keys(participant)
    .filter((key) => !/puuid|summoner|riotid|companion/i.test(key))
    .sort();

  return {
    matchId: payload?.metadata?.match_id || null,
    infoKeys: Object.keys(info).filter((key) => key !== "participants").sort(),
    relevantInfoFields: {
      game_version: info.game_version ?? null,
      tft_set_number: info.tft_set_number ?? null,
      tft_set_core_name: info.tft_set_core_name ?? null,
      queue_id: info.queue_id ?? info.queueId ?? null,
    },
    participantKeys: safeParticipantKeys,
    relevantParticipantFields: {
      augments: Object.hasOwn(participant, "augments")
        ? participant.augments
        : "<absent>",
      ...Object.fromEntries(
        Object.entries(participant).filter(
          ([key]) => key !== "augments" && /augment|set/i.test(key),
        ),
      ),
    },
  };
}

export async function runInspectCli({
  argv = process.argv.slice(2),
  env = process.env,
  output = console,
  fetchImpl = globalThis.fetch,
} = {}) {
  const options = parseInspectArgs(argv);
  const apiKey = String(env.RIOT_API_KEY || "").trim();
  if (!apiKey) throw new Error("RIOT_API_KEY is required.");

  const client = new RiotTftClient({
    platform: options.platform,
    httpClient: new RiotHttpClient({ apiKey, fetchImpl }),
  });
  const payload = await client.fetchMatch(options.matchId);
  const summary = summarizeRawMatch(payload);
  output.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (path.resolve(process.argv[1] || "") === __filename) {
  runInspectCli().catch((error) => {
    console.error(`Riot match inspection failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

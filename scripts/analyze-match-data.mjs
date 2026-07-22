import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMatchData } from "../server/src/matchData/matchDataAnalysis.js";
import { loadProjectEnv, projectRoot } from "./lib/project-env.mjs";

function usage() {
  return "Usage: npm run analyze:match-data -- [--minimum-samples 3] [--top 20] [--json]";
}

export function parseAnalysisArgs(argv = []) {
  const options = { minimumSamples: 3, top: 20, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (!["--minimum-samples", "--top"].includes(argument) || argv[index + 1] === undefined) {
      throw new Error(usage());
    }
    const value = Number(argv[index + 1]);
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      throw new Error(`${argument} must be an integer from 1 to 1000.`);
    }
    options[argument === "--top" ? "top" : "minimumSamples"] = value;
    index += 1;
  }
  return options;
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatFingerprint(entry) {
  return `${entry.fingerprint} | boards ${entry.boardCount} | placements ${entry.sampleSize} | avg ${entry.averagePlacement?.toFixed(2) ?? "n/a"} | Top 4 ${percent(entry.top4Rate)} | wins ${percent(entry.winRate)}`;
}

export function formatAnalysisText(result) {
  const lines = [
    `Repository path: ${result.repositoryPath}`,
    `Total matches: ${result.totalMatches}`,
    `Total participant-board samples: ${result.totalParticipantBoardSamples}`,
    "Counts by set:",
    ...result.countsBySet.map((entry) => `  ${entry.value}: ${entry.matches} matches, ${entry.boards} boards`),
    "Counts by patch:",
    ...result.countsByPatch.map((entry) => `  ${entry.value}: ${entry.matches} matches, ${entry.boards} boards`),
    `Unique exact board fingerprints: ${result.uniqueBoardFingerprints}`,
    `Unique context fingerprints: ${result.uniqueContextFingerprints}`,
    "Fingerprint frequency:",
    `  once: ${result.fingerprintFrequency.once}`,
    `  at least 2: ${result.fingerprintFrequency.atLeast2}`,
    `  at least 3: ${result.fingerprintFrequency.atLeast3}`,
    `  at least 5: ${result.fingerprintFrequency.atLeast5}`,
    `  at least 10: ${result.fingerprintFrequency.atLeast10}`,
    `Placement statistics (${result.minimumSamples}+ samples):`,
    ...result.placementStatistics.map((entry) => `  ${formatFingerprint(entry)}`),
    `Top ${result.top} most common fingerprints:`,
    ...result.topCommonFingerprints.map((entry) => `  ${formatFingerprint(entry)}`),
    `Top ${result.top} best-performing fingerprints (${result.minimumSamples}+ samples):`,
    ...result.topPerformingFingerprints.map((entry) => `  ${formatFingerprint(entry)}`),
    "Data completeness:",
    ...Object.entries(result.completeness).map(([key, value]) => `  ${key}: ${value}`),
    "Placement distribution:",
    ...Object.entries(result.placementDistribution).map(([placement, count]) => `  ${placement}: ${count}`),
    `Readiness: ${result.readiness.classification}`,
    "Readiness thresholds:",
    ...Object.entries(result.readiness.thresholds).map(([key, value]) => `  ${key}: ${value}`),
  ];
  return lines.join("\n");
}

export async function runAnalysisCli({
  argv = process.argv.slice(2),
  env = process.env,
  output = console,
  loadEnv = loadProjectEnv,
  readFile = fs.readFile,
} = {}) {
  loadEnv(env);
  const options = parseAnalysisArgs(argv);
  const repositoryPath = path.resolve(
    env.TFT_MATCH_DATA_PATH || path.join(projectRoot, "server/data/importedMatches.json"),
  );
  let raw;
  try {
    raw = await readFile(repositoryPath, "utf8");
  } catch (error) {
    throw new Error(`Could not read match repository ${repositoryPath}: ${error.message}`);
  }
  if (!String(raw).trim()) throw new Error(`Match repository ${repositoryPath} is empty.`);
  let store;
  try {
    store = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Match repository ${repositoryPath} contains invalid JSON: ${error.message}`);
  }
  const result = {
    repositoryPath,
    minimumSamples: options.minimumSamples,
    top: options.top,
    ...analyzeMatchData(store, options),
  };
  output.log(options.json ? JSON.stringify(result) : formatAnalysisText(result));
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runAnalysisCli().catch((error) => {
    console.error(`Match data analysis failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

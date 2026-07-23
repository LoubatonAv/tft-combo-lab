import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMatchData } from "../server/src/matchData/matchDataAnalysis.js";
import { createAnalysisMetadata } from "../server/src/matchData/boardSignatures.js";
import { loadProjectEnv, projectRoot } from "./lib/project-env.mjs";

function usage() {
  return "Usage: npm run analyze:match-data -- [--minimum-samples 3] [--top 20] [--set 17] [--patch 16.14] [--patch-min 16.13] [--patch-max 16.14] [--similarity-diagnostics] [--json]";
}

export function parseAnalysisArgs(argv = []) {
  const options = { minimumSamples: 3, top: 20, json: false, similarityDiagnostics: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--similarity-diagnostics") {
      options.similarityDiagnostics = true;
      continue;
    }
    if (!["--minimum-samples", "--top", "--set", "--patch", "--patch-min", "--patch-max"].includes(argument) || argv[index + 1] === undefined) {
      throw new Error(usage());
    }
    const rawValue = argv[index + 1];
    if (["--minimum-samples", "--top", "--set"].includes(argument)) {
      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error(`${argument} must be an integer from 1 to 1000.`);
      options[argument === "--top" ? "top" : argument === "--set" ? "setNumber" : "minimumSamples"] = value;
    } else {
      if (!/^\d+\.\d+$/.test(rawValue)) throw new Error(`${argument} must use numeric major.minor format.`);
      options[argument === "--patch" ? "patch" : argument === "--patch-min" ? "patchMin" : "patchMax"] = rawValue;
    }
    index += 1;
  }
  return options;
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatFingerprint(entry) {
  return `${entry.signature} | boards ${entry.boardCount} | placements ${entry.sampleSize} | avg ${entry.averagePlacement?.toFixed(2) ?? "n/a"} | Top 4 ${percent(entry.top4Rate)} | wins ${percent(entry.winRate)}`;
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
    ...result.warnings.map((warning) => `WARNING: ${warning}`),
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
    "Signature frequencies:",
    ...Object.entries(result.signatureStatistics).flatMap(([type, stats]) => [
      `  ${type}: unique ${stats.uniqueCount}, once ${stats.once}, 2+ ${stats.atLeast2}, 3+ ${stats.atLeast3}, 5+ ${stats.atLeast5}, 10+ ${stats.atLeast10}, largest ${stats.largestGroupSize}`,
      ...stats.topGroups.map((entry) => `    ${formatFingerprint(entry)} | patches ${entry.patches.join(",") || "n/a"} | units ${entry.representativeUnitIds.join(",")} | traits ${entry.representativeActiveTraits.join(",")} | carries ${entry.representativeCarries.map((carry) => carry.unitId).join(",")}`),
    ]),
    ...(result.similarityDiagnostics.length ? [
      "Similarity diagnostics:",
      ...result.similarityDiagnostics.map((entry) => `  ${entry.boardSignature} -> ${entry.neighborSignature}: ${entry.similarity.toFixed(4)} (${entry.patchRelationship}, same placement: ${entry.samePlacement}) ${JSON.stringify(entry.components)}`),
      `Similarity distribution: ${JSON.stringify(result.similarityDistribution)}`,
    ] : []),
    `Exact-signature readiness: ${result.readiness.exactSignatures}`,
    `Relaxed-signature readiness: ${result.readiness.relaxedSignatures}`,
    `Nearest-neighbor readiness: ${result.readiness.nearestNeighbor}`,
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
  metadata: suppliedMetadata,
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
  const metadata = suppliedMetadata || await Promise.all([
    readFile(path.join(projectRoot, "server/data/itemCatalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(projectRoot, "server/data/champions.json"), "utf8").then(JSON.parse),
    readFile(path.join(projectRoot, "server/data/traits.json"), "utf8").then(JSON.parse),
  ]).then(([itemCatalog, champions, traits]) => createAnalysisMetadata({ itemCatalog, champions, traits }));
  const result = {
    repositoryPath,
    minimumSamples: options.minimumSamples,
    top: options.top,
    ...analyzeMatchData(store, {
      ...options,
      metadata,
    }),
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

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeFinalBoard } from "../../server/src/matchData/boardNormalizer.js";
import { calculateNeighborWeight, HistoricalBoardEvaluationService, resolveMatchRepositoryPath } from "../../server/src/matchData/historicalBoardEvaluation.js";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";

const champions = [
  { id: "a", apiName: "TFT17_A", cost: 5, traits: ["Alpha"] },
  { id: "b", apiName: "TFT17_B", cost: 4, traits: ["Alpha"] },
  { id: "c", apiName: "TFT17_C", cost: 3, traits: ["Beta"] },
  { id: "d", apiName: "TFT17_D", cost: 2, traits: ["Beta"] },
  { id: "e", apiName: "TFT17_E", cost: 1, traits: ["Gamma"] },
  { id: "f", apiName: "TFT17_F", cost: 1, traits: ["Gamma"] },
  { id: "g", apiName: "TFT17_G", cost: 1, traits: ["Gamma"] },
  { id: "h", apiName: "TFT17_H", cost: 1, traits: ["Gamma"] },
  { id: "x", apiName: "TFT17_X", cost: 5, traits: ["Other"] },
  { id: "a18", apiName: "TFT18_A", cost: 5, traits: ["Alpha"] },
];
const traits = [
  { name: "Alpha", apiName: "TFT17_Alpha" },
  { name: "Beta", apiName: "TFT17_Beta" },
  { name: "Gamma", apiName: "TFT17_Gamma" },
  { name: "Other", apiName: "TFT17_Other" },
];
const itemCatalog = {
  "Sword Item": { iconUrl: "https://example/tft_item_sworditem.png", components: ["B.F. Sword", "Recurve Bow"] },
};
const metadataSource = { champions, traits, itemCatalog };

function board({ setNumber = 17, patch = "16.14", units = ["a", "b", "c", "d", "e", "f", "g", "h"], trait = "Alpha" } = {}) {
  return normalizeFinalBoard({
    setNumber,
    patch,
    units: units.map((id, index) => ({ id, starLevel: 2, itemIds: index === 0 ? ["tft_item_sworditem"] : [] })),
    activeTraits: [{ name: trait, activeTier: 1, count: 2, isActive: true }],
  }, { champions, traits });
}

function storedMatch(id, placement, historicalBoard, participantId = `private-${id}`) {
  return {
    matchId: id,
    set: historicalBoard.setNumber,
    patch: historicalBoard.patch,
    participants: [{ participantId, placement, board: historicalBoard }],
  };
}

async function setup(t, matches) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "historical-eval-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "matches.json");
  await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 2, matches, derivedBoardStatistics: [] }));
  const repository = new JsonMatchRepository(filePath);
  const service = new HistoricalBoardEvaluationService({ repository, loadMetadata: async () => metadataSource });
  return { filePath, repository, service };
}

test("identical neighbors produce exact weighted statistics and effective sample size", async (t) => {
  const candidate = board();
  const { service } = await setup(t, [1, 4, 8].map((placement, index) => storedMatch(`m${index}`, placement, candidate)));
  const result = await service.evaluate(candidate, { minimumNeighbors: 3, debugNeighbors: true });

  assert.equal(result.status, "available");
  assert.equal(result.rawNeighborCount, 3);
  assert.equal(result.effectiveSampleSize, 3);
  assert.equal(result.weightedAveragePlacement, 4.333);
  assert.equal(result.weightedTop4Rate, 0.6667);
  assert.equal(result.weightedWinRate, 0.3333);
  assert.equal(result.averageSimilarity, 1);
  assert.equal(result.maximumSimilarity, 1);
  assert.equal(result.largestNeighborWeightShare, 0.3333);
  assert.equal(result.dominantNeighbor, false);
  assert.equal(result.distinctOutcomeCount, 3);
  assert.equal(result.weightedPlacementStandardDeviation, 2.867);
  assert.ok(Math.abs(result.neighbors.reduce((sum, neighbor) => sum + neighbor.normalizedWeight, 0) - 1) < 0.001);
  assert.doesNotMatch(JSON.stringify(result), /private-|"matchId"|rawSource|participantId/);
});

test("source identity enforces leave-one-out while identity-free exact boards remain eligible", async (t) => {
  const candidate = board();
  const { service } = await setup(t, [
    storedMatch("source", 1, candidate, "source-participant"),
    storedMatch("other", 8, candidate, "other-participant"),
  ]);
  const withoutIdentity = await service.evaluate(candidate, { minimumNeighbors: 1 });
  assert.equal(withoutIdentity.rawNeighborCount, 2);
  assert.equal(withoutIdentity.selfRecordExcluded, false);

  const leaveOneOut = await service.evaluate(candidate, {
    minimumNeighbors: 1,
    sourceMatchId: "source",
    sourceParticipantIndex: 0,
    debugNeighbors: true,
  });
  assert.equal(leaveOneOut.rawNeighborCount, 1);
  assert.equal(leaveOneOut.selfRecordExcluded, true);
  assert.equal(leaveOneOut.weightedAveragePlacement, 8);
  assert.doesNotMatch(JSON.stringify(leaveOneOut), /source-participant|other-participant|"source"|"other"/);
});

test("weighting modes are deterministic and threshold-relative weighting is more aggressive", () => {
  assert.ok(Math.abs(calculateNeighborWeight(0.8, 0.65, "similarity-squared") - 0.64) < 1e-12);
  assert.equal(calculateNeighborWeight(0.65, 0.65, "threshold-relative-squared"), 0);
  const moderate = calculateNeighborWeight(0.8, 0.65, "threshold-relative-squared");
  assert.ok(Math.abs(moderate - (0.15 / 0.35) ** 2) < 1e-12);
  assert.ok(calculateNeighborWeight(1, 0.65, "threshold-relative-squared") / moderate > calculateNeighborWeight(1, 0.65, "similarity-squared") / 0.64);
});

test("ESS, dominance, and outcome-diversity caps prevent inflated confidence", async (t) => {
  const candidate = board();
  const similar = board({ units: ["a", "b", "c", "d", "e", "f", "g", "x"] });
  const { service: dominatedService } = await setup(t, [
    storedMatch("exact", 1, candidate),
    storedMatch("similar", 8, similar),
  ]);
  const dominated = await dominatedService.evaluate(candidate, {
    minimumNeighbors: 1,
    weightingMode: "threshold-relative-squared",
  });
  assert.equal(dominated.dominantNeighbor, true);
  assert.ok(dominated.largestNeighborWeightShare > 0.5);
  assert.ok(dominated.effectiveSampleSize < 2);
  assert.ok(dominated.confidence <= 0.24);
  assert.equal(dominated.confidenceClassification, "very low");
  assert.equal(dominated.reliabilityStatus, "insufficient-effective-sample");

  const repeatedOutcomeMatches = Array.from({ length: 20 }, (_, index) => storedMatch(`same-outcome-${index}`, 1, candidate));
  const { service: repeatedService } = await setup(t, repeatedOutcomeMatches);
  const repeated = await repeatedService.evaluate(candidate);
  assert.equal(repeated.rawNeighborCount, 20);
  assert.equal(repeated.distinctOutcomeCount, 1);
  assert.ok(repeated.confidence <= 0.64);
  assert.notEqual(repeated.confidenceClassification, "high");
  assert.equal(repeated.reliabilityStatus, "low-dispersion-confidence");
});

test("similar boards qualify while unrelated and different-set boards are excluded", async (t) => {
  const candidate = board();
  const similar = board({ units: ["a", "b", "c", "d", "e", "f", "g", "x"] });
  const unrelated = board({ units: ["x"], trait: "Other" });
  const differentSet = board({ setNumber: 18, units: ["a18"] });
  const { service } = await setup(t, [
    storedMatch("similar", 2, similar),
    storedMatch("unrelated", 8, unrelated),
    storedMatch("different", 1, differentSet),
  ]);
  const result = await service.evaluate(candidate, { minimumNeighbors: 1, minimumSimilarity: 0.65, debugNeighbors: true });

  assert.equal(result.rawNeighborCount, 1);
  assert.equal(result.neighbors[0].placement, 2);
  assert.ok(result.neighbors[0].similarity < 1);
});

test("same patch is preferred before cross-patch fallback", async (t) => {
  const candidate = board();
  const crossPatch = board({ patch: "16.13" });
  const samePatch = board({ units: ["a", "b", "c", "d", "e", "f", "g", "x"] });
  const { service } = await setup(t, [storedMatch("cross", 1, crossPatch), storedMatch("same", 6, samePatch)]);
  const preferred = await service.evaluate(candidate, { patch: "16.14", maximumNeighbors: 1, minimumNeighbors: 1, debugNeighbors: true });
  assert.equal(preferred.neighbors[0].patch, "16.14");

  const { service: fallbackService } = await setup(t, [storedMatch("cross", 1, crossPatch)]);
  const fallback = await fallbackService.evaluate(candidate, { patch: "16.14", minimumNeighbors: 1 });
  assert.equal(fallback.patchesRepresented[0].patch, "16.13");
});

test("confidence grows with stronger samples, penalizes partial boards, and caps broad trait matches", async (t) => {
  const candidate = board();
  const strongMatches = Array.from({ length: 12 }, (_, index) => storedMatch(`strong-${index}`, (index % 8) + 1, candidate));
  const { service: strongService } = await setup(t, strongMatches);
  const strong = await strongService.evaluate(candidate);

  const partial = board({ units: ["a", "b", "c", "d", "e", "f"] });
  const partialResult = await strongService.evaluate(partial);
  assert.equal(partialResult.isPartialBoard, true);
  assert.ok(partialResult.confidence < strong.confidence);
  assert.notEqual(partialResult.confidenceClassification, "high");

  const traitOnly = board({ units: ["x"], trait: "Alpha" });
  const broad = await strongService.evaluate(traitOnly, { minimumSimilarity: 0.1 });
  assert.notEqual(broad.confidenceClassification, "high");
});

test("empty and malformed repositories return unavailable without throwing", async (t) => {
  const { service } = await setup(t, []);
  assert.equal((await service.evaluate(board())).status, "unavailable");
  await fs.writeFile(service.repository.filePath, "{");
  assert.equal((await service.evaluate(board())).status, "unavailable");
});

test("index cache invalidates when the configured repository file changes", async (t) => {
  const candidate = board();
  const { service, filePath } = await setup(t, [storedMatch("first", 1, candidate)]);
  assert.equal((await service.evaluate(candidate, { minimumNeighbors: 1 })).rawNeighborCount, 1);
  await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 2, matches: [storedMatch("first", 1, candidate), storedMatch("second-longer-id", 2, candidate)], derivedBoardStatistics: [] }));
  assert.equal((await service.evaluate(candidate, { minimumNeighbors: 1 })).rawNeighborCount, 2);
});

test("repository path resolution respects TFT_MATCH_DATA_PATH", () => {
  const configured = path.join(os.tmpdir(), "configured-match-data.json");
  assert.equal(resolveMatchRepositoryPath({ TFT_MATCH_DATA_PATH: configured }, "fallback.json"), path.resolve(configured));
});

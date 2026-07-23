import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoricalObservationDebug,
  historicalObserveModeEnabled,
  normalizeOptimizerCandidate,
  observeOptimizerResults,
} from "../../server/src/matchData/optimizerHistoricalObservation.js";

const data = {
  champions: [
    { id: "a", apiName: "TFT17_A", cost: 5, traits: ["Alpha"] },
    { id: "b", apiName: "TFT17_B", cost: 4, traits: ["Alpha"] },
    { id: "c", apiName: "TFT17_C", cost: 3, traits: ["Beta"] },
  ],
  traits: [{ name: "Alpha", apiName: "TFT17_Alpha", breakpoints: [2, 4] }],
};

function candidate(id, score, units = data.champions) {
  return {
    id,
    score,
    label: id,
    units: structuredClone(units),
    starPlans: { a: { starLevel: 2 } },
    activeTraits: [{ name: "Alpha", count: 2, activeAt: 1, isActive: true }],
    frontlineSelection: { mode: "flex", selectedCount: 3, requestedMinimum: 3, requestedMaximum: 6 },
  };
}

const evaluation = {
  status: "available",
  weightedAveragePlacement: 3.5,
  weightedTop4Rate: 0.75,
  weightedWinRate: 0.2,
  rawNeighborCount: 10,
  effectiveSampleSize: 8,
  averageSimilarity: 0.82,
  maximumSimilarity: 0.94,
  confidence: 0.8,
  confidenceClassification: "high",
  reliabilityStatus: "reliable",
  isPartialBoard: true,
};

test("observe mode appends metadata without changing candidates, scores, ordering, or units", async () => {
  const original = [candidate("tie-a", 100), candidate("tie-b", 100), candidate("lower", 90)];
  const snapshot = structuredClone(original);
  const calls = [];
  const observed = await observeOptimizerResults({
    results: original,
    data,
    evaluator: { async evaluate(board) { calls.push(board); return evaluation; } },
  });

  assert.deepEqual(original, snapshot, "the optimizer output must not be mutated");
  assert.equal(calls.length, original.length, "only supplied final candidates are evaluated");
  assert.deepEqual(observed.map(({ historicalEvaluation, ...result }) => result), snapshot);
  assert.deepEqual(observed.map((result) => result.id), ["tie-a", "tie-b", "lower"]);
  assert.deepEqual(observed.map((result) => result.score), [100, 100, 90]);
  assert.deepEqual(observed.map((result) => result.units), snapshot.map((result) => result.units));
  assert.deepEqual(observed.map((result) => result.frontlineSelection), snapshot.map((result) => result.frontlineSelection));
  assert.ok(observed.every((result) => result.historicalEvaluation === evaluation));
});

test("disabled mode preserves the original response shape and performs no evaluation", async () => {
  const original = [candidate("one", 100)];
  let calls = 0;
  const result = await observeOptimizerResults({
    results: original,
    data,
    enabled: false,
    evaluator: { async evaluate() { calls += 1; return evaluation; } },
  });
  assert.equal(result, original);
  assert.equal(calls, 0);
  assert.equal("historicalEvaluation" in result[0], false);
  assert.equal(historicalObserveModeEnabled(undefined), true);
  assert.equal(historicalObserveModeEnabled("true"), true);
  assert.equal(historicalObserveModeEnabled("false"), false);
});

test("one unavailable or failed evaluation cannot fail or reorder optimization", async () => {
  const original = [candidate("available", 100), candidate("failure", 90), candidate("missing", 80)];
  let call = 0;
  const result = await observeOptimizerResults({
    results: original,
    data,
    evaluator: {
      async evaluate() {
        call += 1;
        if (call === 2) throw new Error("malformed repository");
        return call === 3 ? { status: "unavailable" } : evaluation;
      },
    },
  });
  assert.deepEqual(result.map((entry) => entry.id), original.map((entry) => entry.id));
  assert.deepEqual(result.map((entry) => entry.score), original.map((entry) => entry.score));
  assert.equal(result[0].historicalEvaluation.status, "available");
  assert.deepEqual(result[1].historicalEvaluation, { status: "unavailable" });
  assert.deepEqual(result[2].historicalEvaluation, { status: "unavailable" });
});

test("optimizer candidates normalize separately with inferred set and requested patch", () => {
  const result = candidate("one", 100);
  const normalized = normalizeOptimizerCandidate(result, data, { patch: "16.14" });
  assert.equal(normalized.setNumber, 17);
  assert.equal(normalized.patch, "16.14");
  assert.equal(normalized.units[0].unitId, "tft17_a");
  assert.equal(normalized.units[0].starLevel, 2);
  assert.equal(normalized.activeTraits[0].traitId, "tft17_alpha");
  assert.notEqual(normalized, result);
  assert.equal(normalized.normalizationDiagnostics.rawUnitCount, 3);
  assert.equal(normalized.normalizationDiagnostics.resolvedUnitCount, 3);
  assert.equal(normalized.normalizationDiagnostics.unresolvedUnitCount, 0);
  assert.deepEqual(normalized.normalizationDiagnostics.rawOptimizerUnitIds, ["a", "b", "c"]);
  assert.deepEqual(normalized.normalizationDiagnostics.resolvedCatalogUnitIds, ["tft17_a", "tft17_b", "tft17_c"]);
});

test("shared catalog normalization reports unresolved optimizer aliases without silently dropping all units", () => {
  const mixed = candidate("mixed", 100, [data.champions[0], { id: "not-in-catalog" }]);
  const normalized = normalizeOptimizerCandidate(mixed, data, { setNumber: 17 });
  assert.equal(normalized.normalizationDiagnostics.unresolvedUnitCount, 1);
  assert.equal(normalized.normalizationDiagnostics.resolvedUnitCount, 2);
  assert.throws(
    () => normalizeOptimizerCandidate(candidate("bad", 1, [{ id: "unknown" }]), data, { setNumber: 17 }),
    /No optimizer champion IDs resolved/,
  );
});

test("requested board size controls partial classification independently from incomplete context", async () => {
  const six = candidate("six", 100, [
    ...data.champions,
    { id: "d", apiName: "TFT17_D", cost: 2, traits: [] },
    { id: "e", apiName: "TFT17_E", cost: 1, traits: [] },
    { id: "f", apiName: "TFT17_F", cost: 1, traits: [] },
  ]);
  const expandedData = { ...data, champions: six.units };
  const options = [];
  await observeOptimizerResults({
    results: [six], data: expandedData, context: { expectedBoardSize: 6, hasIncompleteContext: true },
    evaluator: { async evaluate(board, received) { options.push({ board, received }); return evaluation; } },
  });
  assert.equal(options[0].received.expectedBoardSize, 6);
  assert.equal(options[0].received.hasIncompleteContext, true);
});

test("development comparison summary is index-based and contains no repository identifiers", () => {
  const results = [
    { ...candidate("secret-id", 100), historicalEvaluation: evaluation },
    { ...candidate("other-secret", 80), historicalEvaluation: { ...evaluation, weightedAveragePlacement: 5.2 } },
  ];
  const summary = buildHistoricalObservationDebug(results, 12.345, 45.678);
  assert.equal(summary.timing.candidateCountEvaluated, 2);
  assert.equal(summary.strongestHistoricalCandidate.candidateIndex, 0);
  assert.equal(summary.weakestHistoricalCandidate.candidateIndex, 1);
  assert.doesNotMatch(JSON.stringify(summary), /secret-id|other-secret|matchId|participant|rawSource/);
});

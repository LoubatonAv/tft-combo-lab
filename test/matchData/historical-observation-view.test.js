import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHistoricalPercent,
  formatHistoricalPlacement,
  historicalObservationViewModel,
} from "../../src/historicalObservation.js";

test("frontend formats available reliable historical observations", () => {
  const view = historicalObservationViewModel({
    status: "available",
    weightedAveragePlacement: 3.824,
    weightedTop4Rate: 0.714,
    weightedWinRate: 0.136,
    confidenceClassification: "high",
    reliabilityStatus: "reliable",
    effectiveSampleSize: 19.44,
    rawNeighborCount: 28,
    averageSimilarity: 0.844,
  });
  assert.equal(view.title, "Historical data (observational)");
  assert.equal(view.averagePlacement, "3.82");
  assert.equal(view.top4Rate, "71%");
  assert.equal(view.winRate, "14%");
  assert.equal(view.averageSimilarity, "84%");
  assert.equal(view.confidence, "High");
  assert.equal(view.reliability, "Reliable");
  assert.equal(view.effectiveSampleSize, "19.4");
  assert.equal(view.rawNeighborCount, 28);
  assert.equal(view.warning, "");
  assert.equal(view.lowConfidence, false);
});

test("frontend distinguishes unavailable, insufficient, dominated, and partial states", () => {
  const unavailable = historicalObservationViewModel({ status: "unavailable" });
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.warning, /unavailable/i);

  const insufficient = historicalObservationViewModel({
    status: "insufficient",
    confidenceClassification: "very low",
    reliabilityStatus: "insufficient-effective-sample",
    isPartialBoard: true,
  });
  assert.equal(insufficient.lowConfidence, true);
  assert.match(insufficient.warning, /Insufficient comparable boards/);
  assert.match(insufficient.warning, /effective sample/);
  assert.match(insufficient.warning, /Partial board/);

  const dominated = historicalObservationViewModel({
    status: "available",
    confidenceClassification: "low",
    reliabilityStatus: "neighbor-dominated",
  });
  assert.match(dominated.warning, /dominates/);

  const lowDispersion = historicalObservationViewModel({
    status: "available",
    confidenceClassification: "medium",
    reliabilityStatus: "low-dispersion-confidence",
  });
  assert.match(lowDispersion.warning, /outcome diversity/);
});

test("frontend percentage and placement formatters handle missing values", () => {
  assert.equal(formatHistoricalPercent(0.715), "72%");
  assert.equal(formatHistoricalPercent(null), "—");
  assert.equal(formatHistoricalPercent(undefined), "—");
  assert.equal(formatHistoricalPlacement(4), "4.00");
  assert.equal(formatHistoricalPlacement(undefined), "—");
});

import {
  canonicalizeIdentifier,
  createChampionIndex,
  normalizeFinalBoard,
} from "./boardNormalizer.js";

export function historicalObserveModeEnabled(value) {
  return String(value ?? "true").trim().toLowerCase() !== "false";
}

function inferSetNumber(result) {
  const explicit = Number(result?.setNumber ?? result?.set);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const inferred = new Set(
    (result?.units || [])
      .map((unit) => String(unit?.apiName || unit?.characterName || "").match(/^TFT(\d+)_/i)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  return inferred.size === 1 ? [...inferred][0] : null;
}

export function normalizeOptimizerCandidate(result, data, context = {}) {
  const championIndex = createChampionIndex(data?.champions || []);
  const rawUnits = result?.units || [];
  const unresolvedUnitCount = rawUnits.filter((unit) => {
    const alias = canonicalizeIdentifier(
      unit?.character_id || unit?.characterId || unit?.apiName ||
      unit?.characterName || unit?.unitId || unit?.id,
    );
    return !alias || !championIndex.has(alias);
  }).length;
  if (rawUnits.length && unresolvedUnitCount === rawUnits.length) {
    throw new Error("No optimizer champion IDs resolved through the shared champion catalog.");
  }
  const board = normalizeFinalBoard({
    setNumber: context.setNumber ?? inferSetNumber(result),
    patch: context.patch ?? result?.patch ?? null,
    units: result?.units || [],
    starPlans: result?.starPlans || {},
    activeTraits: result?.activeTraits || [],
  }, {
    championIndex,
    traits: data?.traits || [],
  });
  return {
    ...board,
    normalizationDiagnostics: {
      rawUnitCount: rawUnits.length,
      resolvedUnitCount: board.units.length,
      unresolvedUnitCount,
      rawOptimizerUnitIds: rawUnits.map((unit) =>
        unit?.id || unit?.apiName || unit?.characterName || unit?.unitId || null,
      ),
      resolvedCatalogUnitIds: board.units.map((unit) => unit.unitId),
    },
  };
}

function unavailableEvaluation() {
  return { status: "unavailable" };
}

export function buildHistoricalObservationDebug(results, optimizerRuntimeMs, historicalRuntimeMs) {
  const available = results
    .map((candidate, index) => ({ index, score: candidate.score, evaluation: candidate.historicalEvaluation }))
    .filter(({ evaluation }) => evaluation?.status === "available");
  const byPlacement = [...available].sort((left, right) =>
    Number(left.evaluation.weightedAveragePlacement) - Number(right.evaluation.weightedAveragePlacement) ||
    left.index - right.index,
  );
  const highScorePoorHistory = available.find(({ evaluation }) => Number(evaluation.weightedAveragePlacement) > 4.5) || null;
  const lowerScoreStrongHistory = [...available]
    .reverse()
    .find(({ evaluation }) => Number(evaluation.weightedAveragePlacement) <= 4) || null;
  const summarize = (entry) => entry ? {
    candidateIndex: entry.index,
    optimizerScore: entry.score,
    weightedAveragePlacement: entry.evaluation.weightedAveragePlacement,
    confidenceClassification: entry.evaluation.confidenceClassification,
  } : null;
  return {
    timing: {
      optimizerRuntimeMs: Number(optimizerRuntimeMs.toFixed(2)),
      historicalEvaluationRuntimeMs: Number(historicalRuntimeMs.toFixed(2)),
      totalRuntimeMs: Number((optimizerRuntimeMs + historicalRuntimeMs).toFixed(2)),
      candidateCountEvaluated: results.length,
    },
    strongestHistoricalCandidate: summarize(byPlacement[0]),
    weakestHistoricalCandidate: summarize(byPlacement.at(-1)),
    highOptimizerScorePoorHistoricalPlacement: summarize(highScorePoorHistory),
    lowerOptimizerScoreStrongHistoricalPlacement: summarize(lowerScoreStrongHistory),
  };
}

export async function observeOptimizerResults({
  results,
  evaluator,
  data,
  enabled = true,
  context = {},
  concurrency = 3,
}) {
  if (!enabled) return results;
  const output = results.map((result) => ({ ...result }));
  let cursor = 0;
  const worker = async () => {
    while (cursor < output.length) {
      const index = cursor++;
      try {
        const board = normalizeOptimizerCandidate(results[index], data, context);
        output[index].historicalEvaluation = await evaluator.evaluate(board, {
          setNumber: board.setNumber,
          patch: board.patch,
          expectedBoardSize: context.expectedBoardSize,
          hasIncompleteContext: context.hasIncompleteContext ?? true,
          debugDiagnostics: context.debugDiagnostics === true,
        });
      } catch {
        output[index].historicalEvaluation = unavailableEvaluation();
      }
    }
  };
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), output.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return output;
}

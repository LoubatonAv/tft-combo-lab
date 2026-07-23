import { calculateBoardStatistics } from "./boardStatistics.js";
import { parseBoardStatsRequest } from "./boardStatsRequest.js";
import { HistoricalBoardEvaluationService } from "./historicalBoardEvaluation.js";

export function createBoardStatsHandler({ loadData, repository }) {
  const evaluator = new HistoricalBoardEvaluationService({
    repository,
    loadMetadata: async () => {
      const data = await loadData();
      return {
        champions: data.champions || [],
        traits: data.traits || [],
        itemCatalog: data.itemCatalog || {},
      };
    },
  });
  return async function boardStatsHandler(req, res) {
    try {
      const data = await loadData();
      const request = parseBoardStatsRequest(req.body, data);
      const historicalEvaluation = await evaluator.evaluate(request.candidateBoard, {
        setNumber: request.setNumber,
        patch: request.patch,
        minimumSimilarity: request.minimumSimilarity,
        maximumNeighbors: request.maximumNeighbors,
        minimumNeighbors: request.minimumNeighbors,
        weightingMode: request.weightingMode,
        debugNeighbors: request.debugHistoricalNeighbors,
        sourceMatchId: request.sourceMatchId,
        sourceParticipantId: request.sourceParticipantId,
        sourceParticipantIndex: request.sourceParticipantIndex,
      });
      let statistics;
      try {
        statistics = await calculateBoardStatistics({
          ...request,
          repository,
        });
      } catch (error) {
        if (historicalEvaluation.status !== "unavailable") throw error;
        statistics = null;
      }

      res.json({
        experimental: true,
        candidateBoard: request.candidateBoard,
        statistics,
        historicalEvaluation,
      });
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      if (statusCode >= 500) console.error(error);
      res.status(statusCode).json({
        error:
          statusCode < 500
            ? error.message
            : "Failed to calculate board statistics.",
      });
    }
  };
}

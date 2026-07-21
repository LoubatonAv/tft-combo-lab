import { calculateBoardStatistics } from "./boardStatistics.js";
import { parseBoardStatsRequest } from "./boardStatsRequest.js";

export function createBoardStatsHandler({ loadData, repository }) {
  return async function boardStatsHandler(req, res) {
    try {
      const data = await loadData();
      const request = parseBoardStatsRequest(req.body, data);
      const statistics = await calculateBoardStatistics({
        ...request,
        repository,
      });

      res.json({
        experimental: true,
        candidateBoard: request.candidateBoard,
        statistics,
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


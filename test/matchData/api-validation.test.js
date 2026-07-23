import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createBoardStatsHandler } from "../../server/src/matchData/boardStatsEndpoint.js";
import { parseBoardStatsRequest } from "../../server/src/matchData/boardStatsRequest.js";

const champions = JSON.parse(
  await fs.readFile(
    new URL("../../server/data/champions.json", import.meta.url),
  ),
);
const traits = JSON.parse(
  await fs.readFile(new URL("../../server/data/traits.json", import.meta.url)),
);
const data = { champions, traits };
const validBody = {
  candidateBoard: {
    units: [{ id: "riven", starLevel: 2 }],
    activeTraits: [],
  },
  set: 17,
};

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("board-stats request validation rejects malformed client inputs", () => {
  const invalidBodies = [
    {},
    { candidateBoard: {}, set: 17 },
    { candidateBoard: { units: [] }, set: 17 },
    { candidateBoard: { units: [{ id: "unknown_unit" }] }, set: 17 },
    { candidateBoard: { units: [{ id: "riven", starLevel: 0 }] }, set: 17 },
    { candidateBoard: { units: [{ id: "riven", starLevel: 2.5 }] }, set: 17 },
    { candidateBoard: { units: [{ id: "riven", starLevel: 5 }] }, set: 17 },
    { candidateBoard: { units: [{ id: "riven" }] } },
    { ...validBody, set: 0 },
    { ...validBody, minimumSimilarity: -0.1 },
    { ...validBody, minimumSimilarity: 1.1 },
    { ...validBody, minimumSimilarity: "not-a-number" },
    { ...validBody, minimumSampleSize: 0 },
    { ...validBody, minimumSampleSize: 1.5 },
    { ...validBody, maximumNeighbors: 0 },
    { ...validBody, maximumNeighbors: 201 },
    { ...validBody, minimumNeighbors: 4, maximumNeighbors: 3 },
    { ...validBody, debugHistoricalNeighbors: "yes" },
    { ...validBody, weightingMode: "invented" },
    { ...validBody, candidateBoard: { ...validBody.candidateBoard, sourceParticipantIndex: -1 } },
    { ...validBody, weights: { unknownWeight: 1 } },
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => parseBoardStatsRequest(body, data),
      (error) => error.statusCode === 400,
    );
  }
});

test("endpoint remains backward compatible and adds a sanitized historical evaluation", async () => {
  const candidate = parseBoardStatsRequest(validBody, data).candidateBoard;
  const repository = {
    async fileSignature() { return "one"; },
    async queryNormalizedBoards() {
      return [{
        matchId: "secret-match",
        participantId: "secret-participant",
        setNumber: 17,
        patch: "16.14",
        placement: 1,
        board: candidate,
      }];
    },
  };
  const handler = createBoardStatsHandler({
    loadData: async () => ({ ...data, itemCatalog: {} }),
    repository,
  });
  const response = responseRecorder();
  await handler({ body: { ...validBody, minimumNeighbors: 1, debugHistoricalNeighbors: true } }, response);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.statistics);
  assert.equal(response.body.historicalEvaluation.status, "available");
  assert.equal(response.body.historicalEvaluation.rawNeighborCount, 1);
  assert.doesNotMatch(JSON.stringify(response.body.historicalEvaluation), /secret-match|secret-participant|rawSource/);
});

test("patch is an optional filter and valid requests normalize safely", () => {
  const parsed = parseBoardStatsRequest(validBody, data);
  assert.equal(parsed.patch, null);
  assert.equal(parsed.setNumber, 17);
  assert.equal(parsed.candidateBoard.patch, null);
  assert.equal(parsed.candidateBoard.units[0].unitId, "tft17_riven");
});

test("endpoint returns 400 for client errors and degrades gracefully for repository failures", async (t) => {
  const clientHandler = createBoardStatsHandler({
    loadData: async () => data,
    repository: { queryNormalizedBoards: async () => [] },
  });
  const clientResponse = responseRecorder();
  await clientHandler({ body: {} }, clientResponse);
  assert.equal(clientResponse.statusCode, 400);
  assert.match(clientResponse.body.error, /candidateBoard/);

  const failingHandler = createBoardStatsHandler({
    loadData: async () => data,
    repository: {
      queryNormalizedBoards: async () => {
        throw new Error("secret repository path and stack details");
      },
    },
  });
  const serverResponse = responseRecorder();
  await failingHandler({ body: validBody }, serverResponse);
  assert.equal(serverResponse.statusCode, 200);
  assert.equal(serverResponse.body.statistics, null);
  assert.equal(serverResponse.body.historicalEvaluation.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(serverResponse.body), /secret repository path/);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";
import { reparseMatchRepository } from "../../server/src/matchData/matchReparseService.js";

const realShape = JSON.parse(
  await fs.readFile(
    new URL("../fixtures/riot-match-real-shape.json", import.meta.url),
  ),
);

async function setup(t, matches) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tft-reparse-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "matches.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 2, matches, derivedBoardStatistics: [] }),
  );
  return { filePath, repository: new JsonMatchRepository(filePath) };
}

function staleMatch(rawSource, matchId, augments = []) {
  return {
    matchId,
    setNumber: 17,
    patch: "16.14",
    importedAt: "2026-07-21T00:00:00.000Z",
    participants: [{
      placement: 2,
      augments,
      board: { setNumber: 17, units: [], activeTraits: [] },
    }],
    rawSource,
  };
}

test("reparse corrects set and augment presence while preserving IDs and rebuilding statistics", async (t) => {
  const absentRaw = structuredClone(realShape);
  absentRaw.metadata.match_id = "RAW_DIFFERENT_ID";
  const emptyRaw = structuredClone(realShape);
  emptyRaw.metadata.match_id = "EMPTY_RAW_ID";
  emptyRaw.info.participants[0].augments = [];
  const missing = staleMatch(null, "NO_RAW");
  const invalid = staleMatch({ metadata: { match_id: "INVALID" }, info: {} }, "BAD_RAW");
  const originalIds = ["ABSENT", "EMPTY", "NO_RAW", "BAD_RAW"];
  const { repository, filePath } = await setup(t, [
    staleMatch(absentRaw, "ABSENT"),
    staleMatch(emptyRaw, "EMPTY"),
    missing,
    invalid,
  ]);
  let writes = 0;
  const originalWrite = repository.writeStore.bind(repository);
  repository.writeStore = async (...args) => {
    writes += 1;
    return originalWrite(...args);
  };

  const result = await reparseMatchRepository({
    repository,
    now: () => new Date("2026-07-23T12:34:56.000Z"),
  });
  const stored = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(writes, 1);
  assert.deepEqual(stored.matches.map((match) => match.matchId), originalIds);
  assert.equal(stored.matches[0].set, 17);
  assert.equal(stored.matches[0].participants[0].board.setNumber, 17);
  assert.equal(stored.matches[0].participants[0].augments, null);
  assert.deepEqual(stored.matches[1].participants[0].augments, []);
  assert.ok(stored.derivedBoardStatistics.length > 0);
  assert.deepEqual(result, {
    totalStoredMatches: 4,
    successfullyReparsed: 2,
    missingRawSource: 1,
    failedReparses: 1,
    failedMatchIds: ["BAD_RAW"],
    backupPath: `${filePath}.backup-2026-07-23T12-34-56-000Z`,
    finalRepositoryTotal: 4,
    derivedStatisticGroups: stored.derivedBoardStatistics.length,
  });
  await fs.access(result.backupPath);
});

test("a fatal replacement failure leaves the original repository unchanged", async (t) => {
  const { repository, filePath } = await setup(t, [
    staleMatch(structuredClone(realShape), "ORIGINAL"),
  ]);
  const originalBytes = await fs.readFile(filePath);
  repository.writeStore = async () => {
    throw new Error("injected write failure");
  };

  await assert.rejects(
    reparseMatchRepository({
      repository,
      now: () => new Date("2026-07-23T12:34:56.000Z"),
    }),
    /injected write failure/,
  );

  assert.deepEqual(await fs.readFile(filePath), originalBytes);
  await fs.access(`${filePath}.backup-2026-07-23T12-34-56-000Z`);
});

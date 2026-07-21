import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";
import { importRiotPayloads } from "../../server/src/matchData/matchImportService.js";

const fixtures = JSON.parse(
  await fs.readFile(new URL("../fixtures/riot-matches.json", import.meta.url)),
);

async function temporaryRepository(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tft-match-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new JsonMatchRepository(path.join(directory, "matches.json"));
}

test("repository prevents duplicate match imports", async (t) => {
  const repository = await temporaryRepository(t);
  const result = await importRiotPayloads({
    payloads: [fixtures[0], fixtures[0]],
    repository,
  });

  assert.equal(result.importedCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(await repository.hasMatch("SET17_001"), true);

  const restartedRepository = new JsonMatchRepository(repository.filePath);
  const afterRestart = await importRiotPayloads({
    payloads: fixtures[0],
    repository: restartedRepository,
  });
  assert.equal(afterRestart.importedCount, 0);
  assert.equal(afterRestart.duplicateCount, 1);
});

test("different participants in one match remain independent samples", async (t) => {
  const repository = await temporaryRepository(t);
  const payload = structuredClone(fixtures[0]);
  payload.metadata.match_id = "TWO_PARTICIPANTS";
  payload.info.participants.push({
    ...structuredClone(payload.info.participants[0]),
    puuid: "second-player",
    placement: 3,
  });

  await importRiotPayloads({ payloads: payload, repository });
  const participants = await repository.queryParticipants({ setNumber: 17 });
  assert.equal(participants.length, 2);
  assert.deepEqual(
    participants.map((entry) => entry.participantId),
    ["player-identical", "second-player"],
  );
});

test("repository filters normalized boards by set and patch", async (t) => {
  const repository = await temporaryRepository(t);
  await importRiotPayloads({
    payloads: [fixtures[0], fixtures[5], fixtures[6]],
    repository,
  });

  assert.equal(await repository.countSamples({ setNumber: 17 }), 2);
  assert.equal(
    await repository.countSamples({ setNumber: 17, patch: "17.7" }),
    1,
  );
  assert.equal(await repository.countSamples({ setNumber: 16 }), 1);

  const derived = await repository.rebuildDerivedBoardStatistics();
  assert.equal(derived.length, 3);
});

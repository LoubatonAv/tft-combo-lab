import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProjectEnv } from "../../scripts/lib/project-env.mjs";

test("project env loader reads dotenv values without overriding process values", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tft-env-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  await fs.writeFile(
    envPath,
    [
      "RIOT_API_KEY=RGAPI-placeholder-from-file",
      "TFT_MATCH_DATA_PATH=C:\\temp\\matches.json",
    ].join("\n"),
  );
  const env = { RIOT_API_KEY: "already-set" };

  assert.equal(loadProjectEnv(env, envPath), env);
  assert.equal(env.RIOT_API_KEY, "already-set");
  assert.equal(env.TFT_MATCH_DATA_PATH, "C:\\temp\\matches.json");
});

test("project env loader tolerates a missing root dotenv file", () => {
  const env = {};
  assert.equal(loadProjectEnv(env, path.join(os.tmpdir(), "missing-tft-env")), env);
  assert.deepEqual(env, {});
});

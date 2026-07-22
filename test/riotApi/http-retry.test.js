import assert from "node:assert/strict";
import test from "node:test";
import {
  RiotApiError,
  RiotHttpClient,
} from "../../server/src/riotApi/riotHttpClient.js";

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}

test("429 respects Retry-After before retrying", async () => {
  const calls = [];
  const sleeps = [];
  const client = new RiotHttpClient({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? response(429, {}, { "retry-after": "2" })
        : response(200, { ok: true });
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0.5,
  });

  assert.deepEqual(await client.requestJson("https://europe.api.riotgames.com/test"), {
    ok: true,
  });
  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["X-Riot-Token"], "test-key");
});

test("transient failures exhaust bounded retries", async () => {
  let calls = 0;
  const client = new RiotHttpClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return response(503, {});
    },
    sleep: async () => {},
    random: () => 0.5,
    maxRetries: 2,
  });

  await assert.rejects(
    client.requestJson("https://europe.api.riotgames.com/test"),
    (error) =>
      error instanceof RiotApiError &&
      error.status === 503 &&
      error.attempts === 3 &&
      error.retryable,
  );
  assert.equal(calls, 3);
});

test("network failures retry, while permanent 4xx responses do not", async () => {
  let networkCalls = 0;
  const networkClient = new RiotHttpClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      networkCalls += 1;
      if (networkCalls === 1) throw new Error("socket reset");
      return response(200, { recovered: true });
    },
    sleep: async () => {},
  });
  assert.deepEqual(
    await networkClient.requestJson("https://europe.api.riotgames.com/test"),
    { recovered: true },
  );

  let permanentCalls = 0;
  const permanentClient = new RiotHttpClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      permanentCalls += 1;
      return response(404, {});
    },
    sleep: async () => assert.fail("Permanent errors must not sleep."),
  });
  await assert.rejects(
    permanentClient.requestJson("https://europe.api.riotgames.com/missing"),
    (error) => error.status === 404 && error.attempts === 1 && !error.retryable,
  );
  assert.equal(permanentCalls, 1);
});

test("missing API key is rejected before any request", () => {
  assert.throws(() => new RiotHttpClient({ apiKey: "" }), /RIOT_API_KEY/);
});


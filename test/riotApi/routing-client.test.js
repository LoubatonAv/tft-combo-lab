import assert from "node:assert/strict";
import test from "node:test";
import {
  getRegionalRouteForPlatform,
  normalizePlatform,
} from "../../server/src/riotApi/riotRouting.js";
import { RiotTftClient } from "../../server/src/riotApi/riotTftClient.js";

test("platforms map to explicit account and match routing regions", () => {
  const expected = {
    na1: "americas",
    br1: "americas",
    la1: "americas",
    la2: "americas",
    euw1: "europe",
    eun1: "europe",
    tr1: "europe",
    ru: "europe",
    kr: "asia",
    jp1: "asia",
    oc1: "sea",
    sg2: "sea",
    tw2: "sea",
    vn2: "sea",
  };

  for (const [platform, region] of Object.entries(expected)) {
    assert.equal(getRegionalRouteForPlatform(platform), region);
  }
  assert.equal(normalizePlatform(" EUW1 "), "euw1");
  assert.throws(() => normalizePlatform("invalid"), /Unsupported Riot platform/);
});

test("Riot ID resolution separates regional Account and platform TFT Summoner calls", async () => {
  const requests = [];
  const httpClient = {
    async requestJson(url) {
      requests.push(url);
      return requests.length === 1
        ? { puuid: "puuid-123", gameName: "Some Name", tagLine: "EUW" }
        : { id: "summoner-id", puuid: "puuid-123", summonerLevel: 42 };
    },
  };
  const client = new RiotTftClient({ httpClient, platform: "euw1" });
  const player = await client.resolveRiotId("Some Name", "EUW");

  assert.match(
    requests[0],
    /^https:\/\/europe\.api\.riotgames\.com\/riot\/account\/v1\/accounts\/by-riot-id\/Some%20Name\/EUW$/,
  );
  assert.equal(
    requests[1],
    "https://euw1.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/puuid-123",
  );
  assert.equal(player.account.puuid, "puuid-123");
  assert.equal(player.summoner.id, "summoner-id");
});

test("match ID and detail fetching use the regional TFT Match API", async () => {
  const requests = [];
  const httpClient = {
    async requestJson(url) {
      requests.push(url);
      return requests.length === 1 ? ["EUW1_1", "EUW1_2"] : { match: true };
    },
  };
  const client = new RiotTftClient({ httpClient, platform: "euw1" });
  const ids = await client.fetchMatchIds("puuid value", {
    start: 5,
    count: 10,
  });
  const match = await client.fetchMatch("EUW1_1");

  assert.deepEqual(ids, ["EUW1_1", "EUW1_2"]);
  assert.equal(match.match, true);
  assert.equal(
    requests[0],
    "https://europe.api.riotgames.com/tft/match/v1/matches/by-puuid/puuid%20value/ids?start=5&count=10",
  );
  assert.equal(
    requests[1],
    "https://europe.api.riotgames.com/tft/match/v1/matches/EUW1_1",
  );
});

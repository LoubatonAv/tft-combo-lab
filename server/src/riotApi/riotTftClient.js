import {
  getPlatformHost,
  getRegionalHost,
  getRegionalRouteForPlatform,
  normalizePlatform,
} from "./riotRouting.js";

function encodePath(value) {
  return encodeURIComponent(String(value));
}

export class RiotTftClient {
  constructor({ httpClient, platform }) {
    if (!httpClient) throw new Error("Riot HTTP client is required.");

    this.httpClient = httpClient;
    this.platform = normalizePlatform(platform);
    this.regionalRoute = getRegionalRouteForPlatform(this.platform);
    this.platformHost = getPlatformHost(this.platform);
    this.regionalHost = getRegionalHost(this.platform);
  }

  async resolveRiotId(gameName, tagLine) {
    const account = await this.httpClient.requestJson(
      `https://${this.regionalHost}/riot/account/v1/accounts/by-riot-id/${encodePath(gameName)}/${encodePath(tagLine)}`,
    );

    if (!account?.puuid) {
      throw new Error("Riot Account API response did not include a PUUID.");
    }

    const summoner = await this.httpClient.requestJson(
      `https://${this.platformHost}/tft/summoner/v1/summoners/by-puuid/${encodePath(account.puuid)}`,
    );

    return {
      platform: this.platform,
      regionalRoute: this.regionalRoute,
      account: {
        puuid: account.puuid,
        gameName: account.gameName || String(gameName),
        tagLine: account.tagLine || String(tagLine),
      },
      summoner,
    };
  }

  async fetchChallengerLeague() {
    return this.httpClient.requestJson(
      `https://${this.platformHost}/tft/league/v1/challenger?queue=RANKED_TFT`,
    );
  }

  async resolveSummonerId(summonerId) {
    const summoner = await this.httpClient.requestJson(
      `https://${this.platformHost}/tft/summoner/v1/summoners/${encodePath(summonerId)}`,
    );

    if (!summoner?.puuid) {
      throw new Error("Riot TFT Summoner API response did not include a PUUID.");
    }
    return summoner;
  }

  async fetchMatchIds(puuid, { start = 0, count = 20 } = {}) {
    const query = new URLSearchParams({
      start: String(start),
      count: String(count),
    });
    const matchIds = await this.httpClient.requestJson(
      `https://${this.regionalHost}/tft/match/v1/matches/by-puuid/${encodePath(puuid)}/ids?${query}`,
    );

    if (!Array.isArray(matchIds)) {
      throw new Error("Riot TFT Match API returned a non-array match list.");
    }

    return matchIds.map(String).filter(Boolean);
  }

  async fetchMatch(matchId) {
    return this.httpClient.requestJson(
      `https://${this.regionalHost}/tft/match/v1/matches/${encodePath(matchId)}`,
    );
  }
}

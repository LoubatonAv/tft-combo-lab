const PLATFORM_TO_REGION = Object.freeze({
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  eun1: "europe",
  euw1: "europe",
  ru: "europe",
  tr1: "europe",
  jp1: "asia",
  kr: "asia",
  oc1: "sea",
  sg2: "sea",
  tw2: "sea",
  vn2: "sea",
});

export const SUPPORTED_RIOT_PLATFORMS = Object.freeze(
  Object.keys(PLATFORM_TO_REGION),
);

export function normalizePlatform(platform) {
  const normalized = String(platform || "").trim().toLowerCase();

  if (!PLATFORM_TO_REGION[normalized]) {
    throw new Error(
      `Unsupported Riot platform "${platform || ""}". Supported values: ${SUPPORTED_RIOT_PLATFORMS.join(", ")}.`,
    );
  }

  return normalized;
}

export function getRegionalRouteForPlatform(platform) {
  return PLATFORM_TO_REGION[normalizePlatform(platform)];
}

export function getPlatformHost(platform) {
  return `${normalizePlatform(platform)}.api.riotgames.com`;
}

export function getRegionalHost(platform) {
  return `${getRegionalRouteForPlatform(platform)}.api.riotgames.com`;
}

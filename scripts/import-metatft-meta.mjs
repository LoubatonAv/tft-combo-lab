import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const CHAMPIONS_PATH = path.join(ROOT, "server/data/champions.json");
const ITEM_SETS_PATH = path.join(ROOT, "server/data/itemSetStats.json");
const ITEM_CATALOG_PATH = path.join(ROOT, "server/data/itemCatalog.json");
const CHAMPION_META_PATH = path.join(ROOT, "server/data/championMeta.json");
const UNIT_UPGRADE_META_PATH = path.join(
  ROOT,
  "server/data/unitUpgradeMeta.json",
);
const UNIT_BUILD_META_PATH = path.join(ROOT, "server/data/unitBuildMeta.json");

const DEFAULT_WAIT_MS = Number(process.env.METATFT_WAIT_MS || 1800);
const DEFAULT_SLEEP_MS = Number(process.env.METATFT_SLEEP_MS || 120);
const MAX_ITEM_SETS = Number(process.env.METATFT_MAX_ITEM_SETS || 5);
const MAX_STAR_BUILDS = Number(process.env.METATFT_MAX_STAR_BUILDS || 5);

const METATFT_CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.METATFT_CONCURRENCY || 4), 8),
);

const IMPORT_STARS = process.env.METATFT_IMPORT_STARS !== "false";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parsePercent(value) {
  const number = Number(
    String(value || "")
      .replace("%", "")
      .trim(),
  );
  return Number.isFinite(number) ? number : null;
}

function parseNumber(value) {
  const number = Number(
    String(value || "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function tierToBaseScore(tier) {
  return (
    {
      S: 94,
      A: 84,
      B: 72,
      C: 60,
      D: 46,
    }[String(tier || "").toUpperCase()] || 60
  );
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function scoreBuild(build = {}) {
  const explicit = Number(build.score || 0);
  if (explicit > 0) return explicit;

  const avgPlace = Number(build.avgPlace || 0);
  const winRate = Number(build.winRate || 0);
  const top4Rate = Number(build.top4Rate || 0);
  const games = Number(build.games || 0);

  let score = tierToBaseScore(build.tier);

  if (avgPlace > 0) score += (4.5 - avgPlace) * 16;
  if (winRate > 0) score += winRate * 0.9;
  if (top4Rate > 0) score += (top4Rate - 50) * 0.18;
  if (games > 0) score += Math.min(games / 180, 14);

  return Math.round(clamp(score, 0, 125));
}

function normalizeMetaTftUrl(champion) {
  return `https://www.metatft.com/units/${encodeURIComponent(
    champion.apiName || champion.characterName || champion.name,
  )}`;
}

function parseGamesCell(value) {
  const text = normalizeText(value);
  const gamesMatch = text.match(/[\d,]+/);
  const percentMatch = text.match(/(\d+(?:\.\d+)?)%/);

  return {
    games: gamesMatch ? parseNumber(gamesMatch[0]) : null,
    playRate: percentMatch ? `${percentMatch[1]}%` : null,
  };
}

function pickLikelyMetricCells(cells = []) {
  // Typical MetaTFT build rows: [items, tier, avg place, delta, win rate, games/play rate]
  // Keep it defensive because MetaTFT changes markup often.
  const avgPlace = parseNumber(cells[2]);
  const delta = parseNumber(cells[3]);
  const winRate = parsePercent(cells[4]);
  const gamesInfo = parseGamesCell(cells[5]);

  return {
    avgPlace,
    delta,
    winRate,
    games: gamesInfo.games,
    playRate: gamesInfo.playRate,
  };
}

async function scrapeVisibleBuildRows(
  page,
  champion,
  { starLevel = null, sourceUrl },
) {
  const rows = await page.$$eval("tr[role='row']", (trs) => {
    return trs
      .map((tr) => {
        const itemImages = [...tr.querySelectorAll("img.TableItemImg")]
          .map((img) => ({
            name: img.getAttribute("alt"),
            iconUrl: img.getAttribute("src"),
          }))
          .filter((item) => item.name && item.iconUrl);

        const items = itemImages.map((item) => item.name);

        const tier =
          tr.querySelector(".StatTierBadge")?.textContent?.trim() ||
          tr.querySelector("[class*='Badge_']")?.textContent?.trim() ||
          null;

        const cells = [...tr.querySelectorAll("td[role='cell']")].map((td) =>
          td.textContent.replace(/\s+/g, " ").trim(),
        );

        return { items, itemImages, tier, cells };
      })
      .filter((row) => row.items.length === 3 && row.tier);
  });

  const unique = new Map();

  for (const row of rows) {
    const metrics = pickLikelyMetricCells(row.cells);
    const key = row.items.map(normalizeItemName).join("|");

    if (!unique.has(key)) {
      const build = {
        id: `${champion.id}-metatft-${starLevel ? `${starLevel}star-` : ""}${unique.size + 1}`,
        starLevel,
        items: row.items,
        itemImages: row.itemImages,
        tier: row.tier,
        ...metrics,
        source: sourceUrl,
      };

      build.score = scoreBuild(build);
      unique.set(key, build);
    }
  }

  return [...unique.values()].sort((a, b) => scoreBuild(b) - scoreBuild(a));
}

async function clickStarFilter(page, starLevel) {
  const wanted = "★".repeat(starLevel);

  const clicked = await page.evaluate((label) => {
    const clean = (value) =>
      String(value || "")
        .replace(/\s+/g, "")
        .trim();
    const candidates = [...document.querySelectorAll("button,[role='button']")];

    const exact = candidates.find((el) => {
      const text = clean(el.textContent);
      const aria = clean(el.getAttribute("aria-label"));
      const title = clean(el.getAttribute("title"));

      return text === label || aria === label || title === label;
    });

    if (exact) {
      exact.click();
      return true;
    }

    const soft = candidates.find((el) => {
      const text = clean(el.textContent);
      const aria = clean(el.getAttribute("aria-label"));
      const title = clean(el.getAttribute("title"));

      return (
        text.includes(label) || aria.includes(label) || title.includes(label)
      );
    });

    if (soft) {
      soft.click();
      return true;
    }

    return false;
  }, wanted);

  if (clicked) {
    await page.waitForTimeout(Number(process.env.METATFT_STAR_WAIT_MS || 800));
  }

  return clicked;
}

async function gotoWithRetry(page, url, retries = 2) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      await page.waitForTimeout(DEFAULT_WAIT_MS);
      return;
    } catch (error) {
      lastError = error;
      console.log(`Retry ${attempt}/${retries} failed for ${url}`);

      await page.waitForTimeout(1200);
    }
  }

  throw lastError;
}

async function scrapeUnitMeta(page, champion) {
  const url = normalizeMetaTftUrl(champion);

  await gotoWithRetry(page, url);

  await page.waitForTimeout(DEFAULT_WAIT_MS);

  const allBuilds = await scrapeVisibleBuildRows(page, champion, {
    starLevel: null,
    sourceUrl: url,
  });

  const byStar = { 1: [], 2: [], 3: [] };
  const starFilterAvailable = {};

  if (IMPORT_STARS) {
    for (const starLevel of [1, 2, 3]) {
      try {
        const clicked = await clickStarFilter(page, starLevel);
        starFilterAvailable[starLevel] = clicked;

        if (clicked) {
          byStar[starLevel] = (
            await scrapeVisibleBuildRows(page, champion, {
              starLevel,
              sourceUrl: url,
            })
          ).slice(0, MAX_STAR_BUILDS);
        }
      } catch {
        starFilterAvailable[starLevel] = false;
      }
    }
  }

  return {
    url,
    allBuilds: allBuilds.slice(0, MAX_ITEM_SETS),
    byStar,
    starFilterAvailable,
  };
}

function getBestBuildFromUnitMeta(unitMeta) {
  const candidates = [
    ...(unitMeta?.allBuilds || []),
    ...Object.values(unitMeta?.byStar || {}).flat(),
  ];

  return candidates.sort((a, b) => scoreBuild(b) - scoreBuild(a))[0] || null;
}

function getBestStarBuild(unitMeta, starLevel) {
  return (
    [...(unitMeta?.byStar?.[starLevel] || [])].sort(
      (a, b) => scoreBuild(b) - scoreBuild(a),
    )[0] || null
  );
}

function deriveChampionMeta(champion, unitMeta) {
  const bestBuild = getBestBuildFromUnitMeta(unitMeta);

  if (!bestBuild) {
    return {
      tier: champion.tier || "C",
      score: 50,
      source: "fallback-no-metatft-builds",
    };
  }

  return {
    tier: bestBuild.tier || champion.tier || "B",
    score: Math.round(scoreBuild(bestBuild)),
    avgPlace: bestBuild.avgPlace,
    winRate: bestBuild.winRate,
    games: bestBuild.games,
    bestItems: bestBuild.items,
    bestStarLevel: bestBuild.starLevel,
    source: bestBuild.source,
  };
}

function deriveUpgradeMeta(champion, championMeta, unitMeta) {
  const cost = Number(champion.cost || 1);
  const role = String(champion.role || "").toLowerCase();
  const carryLike =
    /carry|caster|assassin|damage|sniper|marksman|ad|ap|flex/i.test(role);
  const best1 = getBestStarBuild(unitMeta, 1);
  const best2 = getBestStarBuild(unitMeta, 2);
  const best3 = getBestStarBuild(unitMeta, 3);

  const best1Score = best1 ? scoreBuild(best1) : 0;
  const best2Score = best2 ? scoreBuild(best2) : 0;
  const best3Score = best3 ? scoreBuild(best3) : 0;
  const tier = String(championMeta.tier || "").toUpperCase();
  const avgPlace = Number(championMeta.avgPlace || 4.5);
  const score = Number(championMeta.score || 50);
  const strongMeta =
    tier === "S" || tier === "A" || avgPlace <= 4.05 || score >= 82;

  if (cost === 1) {
    if (carryLike && best3Score >= Math.max(78, best2Score + 8)) {
      return {
        recommendedStarLevel: 3,
        label: "3★ MetaTFT reroll carry",
        realism: 0.95,
        scoreBonus: 18,
        buildScore: best3Score,
        bestBuild: best3,
        source: best3?.source || championMeta.source || "metatft-star-builds",
      };
    }

    return {
      recommendedStarLevel: 2,
      label: carryLike ? "2★ unless playing reroll" : "2★ easy",
      realism: 1,
      scoreBonus: strongMeta ? 5 : 2,
      buildScore: Math.max(best2Score, score),
      bestBuild: best2 || getBestBuildFromUnitMeta(unitMeta),
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 2) {
    if (carryLike && best3Score >= Math.max(76, best2Score + 6)) {
      return {
        recommendedStarLevel: 3,
        label: "3★ MetaTFT viable reroll",
        realism: 0.82,
        scoreBonus: 16,
        buildScore: best3Score,
        bestBuild: best3,
        source: best3?.source || championMeta.source || "metatft-star-builds",
      };
    }

    return {
      recommendedStarLevel: 2,
      label: "2★ expected",
      realism: 1,
      scoreBonus: strongMeta ? 6 : 2,
      buildScore: Math.max(best2Score, score),
      bestBuild: best2 || getBestBuildFromUnitMeta(unitMeta),
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 3) {
    if (carryLike && best3Score >= Math.max(80, best2Score + 8)) {
      return {
        recommendedStarLevel: 3,
        label: "3★ MetaTFT possible carry",
        realism: 0.55,
        scoreBonus: 14,
        buildScore: best3Score,
        bestBuild: best3,
        source: best3?.source || championMeta.source || "metatft-star-builds",
      };
    }

    return {
      recommendedStarLevel: 2,
      label: "2★ expected",
      realism: 0.95,
      scoreBonus: strongMeta ? 8 : 3,
      buildScore: Math.max(best2Score, score),
      bestBuild: best2 || getBestBuildFromUnitMeta(unitMeta),
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 4) {
    return {
      recommendedStarLevel: 2,
      label: "2★ realistic late-game",
      realism: 0.9,
      scoreBonus: strongMeta ? 12 : 5,
      buildScore: Math.max(best2Score, score),
      bestBuild: best2 || getBestBuildFromUnitMeta(unitMeta),
      source: championMeta.source || "metatft-derived",
    };
  }

  return {
    recommendedStarLevel: 2,
    label: "2★ luxury late-game",
    realism: 0.5,
    scoreBonus: strongMeta ? 10 : 3,
    buildScore: Math.max(best2Score, score),
    bestBuild: best2 || getBestBuildFromUnitMeta(unitMeta),
    source: championMeta.source || "metatft-derived",
  };
}

function buildItemCatalogFromBuilds(itemCatalog, builds) {
  for (const build of builds || []) {
    for (const item of build.itemImages || []) {
      itemCatalog[item.name] = {
        ...(itemCatalog[item.name] || {}),
        iconUrl: item.iconUrl,
        components: itemCatalog[item.name]?.components || [],
      };
    }
  }
}

async function createMetaPage(browser) {
  return browser.newPage({
    viewport: { width: 1600, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
}

async function importSingleChampion(page, champion) {
  try {
    const unitMeta = await scrapeUnitMeta(page, champion);

    const unitBuildEntry = {
      championId: champion.id,
      name: champion.name,
      apiName: champion.apiName || champion.characterName,
      source: unitMeta.url,
      allBuilds: unitMeta.allBuilds,
      byStar: unitMeta.byStar,
      starFilterAvailable: unitMeta.starFilterAvailable,
      importedAt: new Date().toISOString(),
    };

    const championMetaEntry = deriveChampionMeta(champion, unitBuildEntry);
    const unitUpgradeEntry = deriveUpgradeMeta(
      champion,
      championMetaEntry,
      unitBuildEntry,
    );

    const best = getBestBuildFromUnitMeta(unitBuildEntry);
    const starSummary = [1, 2, 3]
      .map((star) => `${star}★:${unitBuildEntry.byStar?.[star]?.length || 0}`)
      .join(" ");

    console.log(
      `${champion.name}: ${unitMeta.allBuilds.length} builds · ${starSummary}`,
      best?.items?.join(" / ") || "no build",
    );

    return {
      champion,
      itemSets: unitMeta.allBuilds,
      unitBuildEntry,
      championMetaEntry,
      unitUpgradeEntry,
      ok: true,
    };
  } catch (error) {
    const unitBuildEntry = {
      championId: champion.id,
      name: champion.name,
      source: normalizeMetaTftUrl(champion),
      allBuilds: [],
      byStar: { 1: [], 2: [], 3: [] },
      error: error.message,
      importedAt: new Date().toISOString(),
    };

    const championMetaEntry = deriveChampionMeta(champion, unitBuildEntry);
    const unitUpgradeEntry = deriveUpgradeMeta(
      champion,
      championMetaEntry,
      unitBuildEntry,
    );

    console.log(`${champion.name}: failed - ${error.message}`);

    return {
      champion,
      itemSets: [],
      unitBuildEntry,
      championMetaEntry,
      unitUpgradeEntry,
      ok: false,
    };
  }
}

async function main() {
  const champions = await readJson(CHAMPIONS_PATH, []);
  const existingItemCatalog = await readJson(ITEM_CATALOG_PATH, {});

  const browser = await chromium.launch({
    headless: process.env.METATFT_HEADLESS !== "false",
  });

  const itemSetStats = {};
  const itemCatalog = { ...existingItemCatalog };
  const championMeta = {};
  const unitUpgradeMeta = {};
  const unitBuildMeta = {};

  let cursor = 0;

  async function worker(workerId) {
    const page = await createMetaPage(browser);

    try {
      while (cursor < champions.length) {
        const currentIndex = cursor;
        cursor += 1;

        const champion = champions[currentIndex];

        console.log(
          `[worker ${workerId}] ${currentIndex + 1}/${champions.length} ${champion.name}`,
        );

        const result = await importSingleChampion(page, champion);

        itemSetStats[result.champion.id] = result.itemSets;
        unitBuildMeta[result.champion.id] = result.unitBuildEntry;
        championMeta[result.champion.id] = result.championMetaEntry;
        unitUpgradeMeta[result.champion.id] = result.unitUpgradeEntry;

        buildItemCatalogFromBuilds(
          itemCatalog,
          result.unitBuildEntry.allBuilds,
        );

        for (const builds of Object.values(
          result.unitBuildEntry.byStar || {},
        )) {
          buildItemCatalogFromBuilds(itemCatalog, builds);
        }

        await sleep(DEFAULT_SLEEP_MS);
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  const workerCount = Math.min(METATFT_CONCURRENCY, champions.length || 1);

  console.log(
    `Starting MetaTFT import with ${workerCount} worker${workerCount === 1 ? "" : "s"}...`,
  );

  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => worker(index + 1)),
  );

  await browser.close();

  await fs.writeFile(
    ITEM_SETS_PATH,
    JSON.stringify(itemSetStats, null, 2),
    "utf8",
  );

  await fs.writeFile(
    ITEM_CATALOG_PATH,
    JSON.stringify(itemCatalog, null, 2),
    "utf8",
  );

  await fs.writeFile(
    CHAMPION_META_PATH,
    JSON.stringify(championMeta, null, 2),
    "utf8",
  );

  await fs.writeFile(
    UNIT_UPGRADE_META_PATH,
    JSON.stringify(unitUpgradeMeta, null, 2),
    "utf8",
  );

  await fs.writeFile(
    UNIT_BUILD_META_PATH,
    JSON.stringify(unitBuildMeta, null, 2),
    "utf8",
  );

  console.log(`Saved ${ITEM_SETS_PATH}`);
  console.log(`Saved ${ITEM_CATALOG_PATH}`);
  console.log(`Saved ${CHAMPION_META_PATH}`);
  console.log(`Saved ${UNIT_UPGRADE_META_PATH}`);
  console.log(`Saved ${UNIT_BUILD_META_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

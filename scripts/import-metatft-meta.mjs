import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const CHAMPIONS_PATH = path.join(ROOT, "server/data/champions.json");
const ITEM_SETS_PATH = path.join(ROOT, "server/data/itemSetStats.json");
const ITEM_CATALOG_PATH = path.join(ROOT, "server/data/itemCatalog.json");
const CHAMPION_META_PATH = path.join(ROOT, "server/data/championMeta.json");
const UNIT_UPGRADE_META_PATH = path.join(ROOT, "server/data/unitUpgradeMeta.json");

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
  const number = Number(String(value || "").replace("%", "").trim());
  return Number.isFinite(number) ? number : null;
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function tierToBaseScore(tier) {
  return (
    {
      S: 92,
      A: 82,
      B: 70,
      C: 58,
      D: 45,
    }[String(tier || "").toUpperCase()] || 62
  );
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function scoreItemSet(set) {
  return clamp(
    Number(set.score || 0) ||
      tierToBaseScore(set.tier) +
        Number(set.winRate || 0) * 1.4 -
        Number(set.avgPlace || 4.5) * 7 +
        Math.min(Number(set.games || 0) / 150, 12),
    0,
    110,
  );
}

function normalizeMetaTftUrl(champion) {
  return `https://www.metatft.com/units/${encodeURIComponent(
    champion.apiName || champion.characterName || champion.name,
  )}`;
}

async function scrapeUnitItemSets(page, champion) {
  const url = normalizeMetaTftUrl(champion);

  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  await page.waitForTimeout(Number(process.env.METATFT_WAIT_MS || 3000));

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
          tr.querySelector(".StatTierBadge")?.textContent?.trim() || null;

        const cells = [...tr.querySelectorAll("td[role='cell']")].map((td) =>
          td.textContent.replace(/\s+/g, " ").trim(),
        );

        return { items, itemImages, tier, cells };
      })
      .filter((row) => row.items.length === 3 && row.tier);
  });

  return rows.slice(0, 3).map((row, index) => {
    const gamesText = row.cells[5] || "";
    const gamesMatch = gamesText.match(/[\d,]+/);
    const playRateMatch = gamesText.match(/(\d+(?:\.\d+)?)%/);

    return {
      id: `${champion.id}-metatft-${index + 1}`,
      items: row.items,
      itemImages: row.itemImages,
      tier: row.tier,
      avgPlace: parseNumber(row.cells[2]),
      delta: parseNumber(row.cells[3]),
      winRate: parsePercent(row.cells[4]),
      games: gamesMatch ? parseNumber(gamesMatch[0]) : null,
      playRate: playRateMatch ? `${playRateMatch[1]}%` : null,
      source: url,
    };
  });
}

function deriveChampionMeta(champion, itemSets) {
  const bestSet = [...(itemSets || [])].sort(
    (a, b) => scoreItemSet(b) - scoreItemSet(a),
  )[0];

  if (!bestSet) {
    return {
      tier: champion.tier || "C",
      score: 50,
      source: "fallback-no-metatft-items",
    };
  }

  const score = Math.round(scoreItemSet(bestSet));

  return {
    tier: bestSet.tier || champion.tier || "B",
    score,
    avgPlace: bestSet.avgPlace,
    winRate: bestSet.winRate,
    games: bestSet.games,
    bestItems: bestSet.items,
    source: bestSet.source,
  };
}

function deriveUpgradeMeta(champion, championMeta) {
  const cost = Number(champion.cost || 1);
  const role = String(champion.role || "").toLowerCase();
  const carryLike = /carry|caster|assassin|damage|sniper|marksman|ad|ap/i.test(
    role,
  );
  const tier = String(championMeta.tier || "").toUpperCase();
  const avgPlace = Number(championMeta.avgPlace || 4.5);
  const score = Number(championMeta.score || 50);

  const strongMeta =
    tier === "S" || tier === "A" || avgPlace <= 4.05 || score >= 82;

  if (cost === 1) {
    if (carryLike && strongMeta) {
      return {
        recommendedStarLevel: 3,
        label: "3★ meta reroll candidate",
        realism: 1,
        scoreBonus: 16,
        source: championMeta.source || "metatft-derived",
      };
    }

    return {
      recommendedStarLevel: carryLike ? 3 : 2,
      label: carryLike ? "3★ reroll possible" : "2★ easy",
      realism: 1,
      scoreBonus: carryLike ? 8 : 2,
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 2) {
    if (carryLike && strongMeta) {
      return {
        recommendedStarLevel: 3,
        label: "3★ viable meta reroll",
        realism: 0.82,
        scoreBonus: 14,
        source: championMeta.source || "metatft-derived",
      };
    }

    return {
      recommendedStarLevel: carryLike ? 3 : 2,
      label: carryLike ? "3★ viable reroll" : "2★ expected",
      realism: carryLike ? 0.78 : 1,
      scoreBonus: carryLike ? 6 : 2,
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 3) {
    if (carryLike && strongMeta) {
      return {
        recommendedStarLevel: 3,
        label: "3★ possible meta carry",
        realism: 0.55,
        scoreBonus: 12,
        source: championMeta.source || "metatft-derived",
      };
    }

    return {
      recommendedStarLevel: 2,
      label: "2★ expected",
      realism: 0.9,
      scoreBonus: 3,
      source: championMeta.source || "metatft-derived",
    };
  }

  if (cost === 4) {
    return {
      recommendedStarLevel: 2,
      label: "2★ realistic late-game",
      realism: 0.85,
      scoreBonus: strongMeta ? 10 : 4,
      source: championMeta.source || "metatft-derived",
    };
  }

  return {
    recommendedStarLevel: 2,
    label: "2★ luxury late-game",
    realism: 0.45,
    scoreBonus: strongMeta ? 8 : 2,
    source: championMeta.source || "metatft-derived",
  };
}

async function main() {
  const champions = await readJson(CHAMPIONS_PATH, []);
  const existingItemCatalog = await readJson(ITEM_CATALOG_PATH, {});

  const browser = await chromium.launch({
    headless: process.env.METATFT_HEADLESS !== "false",
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });

  const itemSetStats = {};
  const itemCatalog = { ...existingItemCatalog };
  const championMeta = {};
  const unitUpgradeMeta = {};

  for (const champion of champions) {
    try {
      const sets = await scrapeUnitItemSets(page, champion);
      itemSetStats[champion.id] = sets;

      for (const set of sets) {
        for (const item of set.itemImages || []) {
          itemCatalog[item.name] = {
            ...(itemCatalog[item.name] || {}),
            iconUrl: item.iconUrl,
            components: itemCatalog[item.name]?.components || [],
          };
        }
      }

      championMeta[champion.id] = deriveChampionMeta(champion, sets);
      unitUpgradeMeta[champion.id] = deriveUpgradeMeta(
        champion,
        championMeta[champion.id],
      );

      console.log(
        `${champion.name}: ${sets.length} item set${sets.length === 1 ? "" : "s"}`,
        sets.map((set) => set.items.join(" / ")).join(" | "),
      );

      await sleep(Number(process.env.METATFT_SLEEP_MS || 300));
    } catch (error) {
      itemSetStats[champion.id] = [];
      championMeta[champion.id] = deriveChampionMeta(champion, []);
      unitUpgradeMeta[champion.id] = deriveUpgradeMeta(
        champion,
        championMeta[champion.id],
      );

      console.log(`${champion.name}: failed - ${error.message}`);
    }
  }

  await browser.close();

  await fs.writeFile(ITEM_SETS_PATH, JSON.stringify(itemSetStats, null, 2), "utf8");
  await fs.writeFile(ITEM_CATALOG_PATH, JSON.stringify(itemCatalog, null, 2), "utf8");
  await fs.writeFile(CHAMPION_META_PATH, JSON.stringify(championMeta, null, 2), "utf8");
  await fs.writeFile(UNIT_UPGRADE_META_PATH, JSON.stringify(unitUpgradeMeta, null, 2), "utf8");

  console.log(`Saved ${ITEM_SETS_PATH}`);
  console.log(`Saved ${ITEM_CATALOG_PATH}`);
  console.log(`Saved ${CHAMPION_META_PATH}`);
  console.log(`Saved ${UNIT_UPGRADE_META_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

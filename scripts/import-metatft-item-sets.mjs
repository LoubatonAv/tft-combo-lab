import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const CHAMPIONS_PATH = path.join(ROOT, "server/data/champions.json");
const OUTPUT_PATH = path.join(ROOT, "server/data/itemSetStats.json");
const CATALOG_PATH = path.join(ROOT, "server/data/itemCatalog.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function scrapeUnitItemSets(page, champion) {
  const url = `https://www.metatft.com/units/${encodeURIComponent(
    champion.apiName || champion.characterName || champion.name,
  )}`;

  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

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

async function main() {
  const champions = await readJson(CHAMPIONS_PATH, []);
  const existingCatalog = await readJson(CATALOG_PATH, {});

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });

  const output = {};
  const itemCatalog = { ...existingCatalog };

  for (const champion of champions) {
    try {
      const sets = await scrapeUnitItemSets(page, champion);

      output[champion.id] = sets;

      for (const set of sets) {
        for (const item of set.itemImages || []) {
          itemCatalog[item.name] = {
            ...(itemCatalog[item.name] || {}),
            iconUrl: item.iconUrl,
            components: itemCatalog[item.name]?.components || [],
          };
        }
      }

      console.log(
        `${champion.name}: ${sets.length} item set${sets.length === 1 ? "" : "s"}`,
        sets.map((set) => set.items.join(" / ")).join(" | "),
      );

      await sleep(300);
    } catch (error) {
      output[champion.id] = [];
      console.log(`${champion.name}: failed - ${error.message}`);
    }
  }

  await browser.close();

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(
    CATALOG_PATH,
    JSON.stringify(itemCatalog, null, 2),
    "utf8",
  );

  console.log(`Saved ${OUTPUT_PATH}`);
  console.log(`Saved ${CATALOG_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

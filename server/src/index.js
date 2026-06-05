import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { optimize } from "./optimizer.js";
import { buildTeamPlannerCode, parseTeamPlannerCode } from "./teamPlannerCode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

async function readJson(relativePath, fallback) {
  try {
    const fullPath = path.join(root, relativePath);
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadData() {
  const champions = await readJson("data/champions.json", []);
  const traits = await readJson("data/traits.json", []);
  const metaComps = await readJson("data/metaComps.json", []);

  const championMeta = await readJson("data/championMeta.json", {});
  const traitMeta = await readJson("data/traitMeta.json", {});
  const itemStats = await readJson("data/itemStats.json", {});
  const itemSetStats = await readJson("data/itemSetStats.json", {});
  const unitUpgradeMeta = await readJson("data/unitUpgradeMeta.json", {});
  const unitBuildMeta = await readJson("data/unitBuildMeta.json", {});
  const itemCatalog = await readJson("data/itemCatalog.json", {});
  const matchHistory = await readJson("data/matchHistory.json", []);
  const augments = await readJson("data/augments.json", []);

  const carryProfiles = await readJson("data/carryProfiles.json", {});
  const traitProfiles = await readJson("data/traitProfiles.json", {});

  return {
    champions,
    traits,
    metaComps,
    championMeta,
    traitMeta,
    itemStats,
    itemSetStats,
    unitUpgradeMeta,
    unitBuildMeta,
    itemCatalog,
    matchHistory,
    augments,
    carryProfiles,
    traitProfiles,
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/data", async (req, res) => {
  const data = await loadData();

  res.json(data);
});


app.post("/api/match-history", async (req, res) => {
  try {
    const data = await loadData();

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      compId: req.body.compId || "",
      placement: Number(req.body.placement || 0),
      rating: req.body.rating || "okay",
      carryId: req.body.carryId || null,
      carryName: req.body.carryName || null,
      units: Array.isArray(req.body.units) ? req.body.units : [],
      traits: Array.isArray(req.body.traits) ? req.body.traits : [],
      notes: String(req.body.notes || "").trim(),
    };

    if (!entry.placement || entry.placement < 1 || entry.placement > 8) {
      throw new Error("Placement must be between 1 and 8.");
    }

    const nextHistory = [entry, ...(data.matchHistory || [])].slice(0, 500);

    await fs.writeFile(
      path.join(root, "data/matchHistory.json"),
      JSON.stringify(nextHistory, null, 2),
      "utf8",
    );

    res.json({ ok: true, entry, matchHistory: nextHistory });
  } catch (error) {
    console.error(error);

    res.status(400).json({
      error: error.message || "Failed to save match result",
    });
  }
});


app.post("/api/team-planner-code", async (req, res) => {
  try {
    const result = await buildTeamPlannerCode({
      units: Array.isArray(req.body.units) ? req.body.units : [],
      setId: req.body.setId,
    });

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(400).json({
      error: error.message || "Failed to build TFT team planner code",
    });
  }
});


app.post("/api/parse-team-planner-code", async (req, res) => {
  try {
    const data = await loadData();
    const result = await parseTeamPlannerCode({
      code: req.body.code || "",
      localChampions: data.champions,
    });

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(400).json({
      error: error.message || "Failed to parse TFT team planner code",
    });
  }
});

app.post("/api/optimize", async (req, res) => {
  try {
    const data = await loadData();

    const results = optimize({
      champions: data.champions,
      traits: data.traits,
      metaComps: data.metaComps,
      championMeta: data.championMeta,
      traitMeta: data.traitMeta,
      itemStats: data.itemStats,
      itemSetStats: data.itemSetStats,
      unitUpgradeMeta: data.unitUpgradeMeta,
      unitBuildMeta: data.unitBuildMeta,
      matchHistory: data.matchHistory,
      carryProfiles: data.carryProfiles,
      traitProfiles: data.traitProfiles,
      lockedUnitIds: Array.isArray(req.body.lockedUnitIds)
        ? req.body.lockedUnitIds
        : [],
      targetTrait: req.body.targetTrait,
      targetCount: Number(req.body.targetCount || 0),
      boardSize: Number(req.body.boardSize || 8),
      minFrontline: Number(req.body.minFrontline || 0),
      carryId: req.body.carryId || "auto",
      maxResults: Number(req.body.maxResults || 12),
      gameModeId: req.body.gameModeId || "capped",
      maxUnitCost: req.body.maxUnitCost ? Number(req.body.maxUnitCost) : null,
      allowEmblems: req.body.allowEmblems === true,
      maxEmblems: Number(req.body.maxEmblems ?? 0),
      allowMechaTransformer: req.body.allowMechaTransformer === true,
      transformedMechaIds: Array.isArray(req.body.transformedMechaIds)
        ? req.body.transformedMechaIds
        : [],
    });

    res.json({ results });
  } catch (error) {
    console.error(error);

    res.status(400).json({
      error: error.message || "Optimization failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`TFT Combo Lab API running on http://localhost:${PORT}`);
});

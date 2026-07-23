import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { optimize } from "../server/src/optimizer.js";
import {
  frontlineCountAllowed,
  frontlineSelectionMetadata,
  parseFrontlineSelection,
} from "../server/src/frontlineSelection.js";
import {
  flexFrontlineMinimum,
  formatFrontlineSelection,
} from "../src/frontlineSelection.js";

test("frontline request parsing preserves numeric mode and validates explicit flex", () => {
  assert.deepEqual(parseFrontlineSelection({ frontlineCount: 4 }, 8), {
    mode: "fixed", minFrontline: 4, maxFrontline: null,
  });
  assert.deepEqual(parseFrontlineSelection({ minFrontline: 2 }, 6), {
    mode: "fixed", minFrontline: 2, maxFrontline: null,
  });
  assert.deepEqual(parseFrontlineSelection({ frontlineCount: "flex" }, 6), {
    mode: "flex", minFrontline: 2, maxFrontline: 4,
  });
  assert.deepEqual(parseFrontlineSelection({ frontlineCount: "flex" }, 8), {
    mode: "flex", minFrontline: 3, maxFrontline: 6,
  });
  for (const value of ["automatic", "3x", "", -1, 9, 2.5]) {
    assert.throws(() => parseFrontlineSelection({ frontlineCount: value }, 8), /frontlineCount/);
  }
});

test("frontline range, metadata, and UI formatting are deterministic", () => {
  const flex = parseFrontlineSelection({ frontlineCount: "flex" }, 8);
  assert.equal(frontlineCountAllowed(2, flex), false);
  assert.equal(frontlineCountAllowed(3, flex), true);
  assert.equal(frontlineCountAllowed(6, flex), true);
  assert.equal(frontlineCountAllowed(7, flex), false);
  assert.deepEqual(frontlineSelectionMetadata(4, flex), {
    mode: "flex", selectedCount: 4, requestedMinimum: 3, requestedMaximum: 6,
    exploredCounts: [3, 4, 5, 6],
  });
  assert.equal(formatFrontlineSelection(frontlineSelectionMetadata(4, flex), 8), "Frontline: Flex → 4/8");
  assert.equal(formatFrontlineSelection(frontlineSelectionMetadata(4, { mode: "fixed", minFrontline: 4 }), 8), "Frontline: 4/8");
  assert.equal(flexFrontlineMinimum(6), 2);
  assert.equal(flexFrontlineMinimum(8), 3);
});

async function loadData() {
  const arrays = new Set(["champions", "traits", "metaComps", "matchHistory", "augments"]);
  const names = ["champions", "traits", "metaComps", "championMeta", "traitMeta", "itemStats", "itemSetStats", "itemCatalog", "unitUpgradeMeta", "unitBuildMeta", "matchHistory", "augments", "carryProfiles", "traitProfiles"];
  const data = {};
  for (const name of names) {
    try {
      data[name] = JSON.parse(await fs.readFile(path.resolve(`server/data/${name}.json`), "utf8"));
    } catch {
      data[name] = arrays.has(name) ? [] : {};
    }
  }
  return data;
}

function optimizerInput(data, overrides = {}) {
  return {
    ...data,
    selectedAugmentIds: [], offeredAugmentIds: [], components: [], playStyle: "first",
    unitStars: {}, liveState: {}, lockedUnitIds: [], targetTrait: null, targetCount: 0,
    boardSize: 8, minFrontline: 3, frontlineMode: "flex", maxFrontline: 6,
    carryId: "auto", maxResults: 5, gameModeId: "capped", maxUnitCost: 5,
    allowEmblems: false, maxEmblems: 0, allowMechaTransformer: false,
    transformedMechaIds: [],
    ...overrides,
  };
}

test("Flex chooses deterministic input-dependent counts, respects locks, and deduplicates boards", async () => {
  const data = await loadData();
  const carryInput = optimizerInput(data, { carryId: "kindred" });
  const tankInput = optimizerInput(data, { lockedUnitIds: ["aatrox", "blitzcrank", "leona"] });
  const carry = optimize(carryInput);
  const carryRepeat = optimize(carryInput);
  const tank = optimize(tankInput);

  assert.notEqual(carry[0].frontlineSelection.selectedCount, tank[0].frontlineSelection.selectedCount);
  for (const result of [...carry, ...tank]) {
    assert.ok(result.frontlineSelection.selectedCount >= 3);
    assert.ok(result.frontlineSelection.selectedCount <= 6);
    assert.equal(result.frontlineSelection.mode, "flex");
  }
  assert.ok(tank.every((result) => ["aatrox", "blitzcrank", "leona"].every((id) => result.units.some((unit) => unit.id === id))));
  assert.equal(new Set(carry.map((result) => result.id)).size, carry.length);
  assert.deepEqual(
    carryRepeat.map((result) => [result.id, result.score, result.frontlineSelection]),
    carry.map((result) => [result.id, result.score, result.frontlineSelection]),
  );
});

test("explicit fixed mode is identical to the legacy numeric optimizer path", async () => {
  const data = await loadData();
  const base = optimizerInput(data, { minFrontline: 4, maxResults: 3 });
  const { frontlineMode, maxFrontline, ...legacyInput } = base;
  const legacy = optimize(legacyInput);
  const fixed = optimize({ ...base, frontlineMode: "fixed", maxFrontline: null });
  assert.deepEqual(fixed, legacy);
  assert.ok(fixed.every((result) => result.frontlineSelection.mode === "fixed"));
  assert.ok(fixed.every((result) => result.frontlineSelection.selectedCount >= 4));
});

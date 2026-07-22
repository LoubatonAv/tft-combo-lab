import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { normalizeFinalBoard } from "../../server/src/matchData/boardNormalizer.js";
import { importRiotPayload } from "../../server/src/matchData/matchImportService.js";
import { parseRiotMatchPayload } from "../../server/src/matchData/riotMatchParser.js";

const fixtures = JSON.parse(
  await fs.readFile(new URL("../fixtures/riot-matches.json", import.meta.url)),
);
const realShapedFixture = JSON.parse(
  await fs.readFile(
    new URL("../fixtures/riot-match-real-shape.json", import.meta.url),
  ),
);

test("parses Riot-style match fields and tolerates missing optional fields", () => {
  const parsed = parseRiotMatchPayload(fixtures[0], {
    importedAt: "2026-07-21T00:00:00.000Z",
  });
  assert.equal(parsed.matchId, "SET17_001");
  assert.equal(parsed.set, 17);
  assert.equal(parsed.setNumber, 17);
  assert.equal(parsed.patch, "17.7");
  assert.equal(parsed.participants[0].placement, 1);
  assert.deepEqual(parsed.participants[0].augments, [
    "tft_augment_one",
    "tft_augment_two",
  ]);

  const missing = importRiotPayload(fixtures[7]);
  assert.equal(missing.setNumber, 17);
  assert.equal(missing.set, 17);
  assert.equal(missing.participants[0].participantId, "participant-1");
  assert.equal(missing.participants[0].board.units[0].starLevel, null);
});

test("real Riot payload shape keeps set and patch semantics independent", () => {
  const imported = importRiotPayload(realShapedFixture);

  assert.equal(imported.set, 17);
  assert.equal(imported.setNumber, 17);
  assert.equal(imported.patch, "16.14");
  assert.equal(imported.participants[0].board.setNumber, 17);
  assert.equal(imported.participants[0].augments, null);
});

test("augment parsing distinguishes missing, empty, and malformed current fields", () => {
  const parseParticipant = (overrides) => {
    const payload = structuredClone(realShapedFixture);
    payload.metadata.match_id = `augment-${Math.random()}`;
    payload.info.participants[0] = {
      ...payload.info.participants[0],
      ...overrides,
    };
    return parseRiotMatchPayload(payload).participants[0];
  };

  assert.deepEqual(
    parseParticipant({
      augments: [
        "TFT_Augment_One",
        "TFT17_Augment_Two",
        "TFT_Augment_Three",
      ],
    }).augments,
    ["tft_augment_one", "tft17_augment_two", "tft_augment_three"],
  );
  assert.equal(parseParticipant({}).augments, null);
  assert.deepEqual(parseParticipant({ augments: [] }).augments, []);
  assert.deepEqual(
    parseParticipant({ augments: [null, 7, {}, "", "TFT_Augment_Valid"] })
      .augments,
    ["tft_augment_valid"],
  );
});

test("set falls back to participant fields and then a consistent unit namespace", () => {
  const participantSet = structuredClone(realShapedFixture);
  delete participantSet.info.tft_set_number;
  participantSet.info.participants[0].set = 17;
  assert.equal(parseRiotMatchPayload(participantSet).set, 17);

  const unitNamespace = structuredClone(realShapedFixture);
  delete unitNamespace.info.tft_set_number;
  assert.equal(parseRiotMatchPayload(unitNamespace).set, 17);
});

test("normalization uses canonical IDs, stable sorting, and stable fingerprints", () => {
  const first = normalizeFinalBoard({
    setNumber: 17,
    gameVersion: "17.7.1",
    units: [
      { character_id: "TFT17_Riven", tier: 2, itemNames: ["Item_B", "Item_A"] },
      { character_id: "TFT17_Ezreal", tier: 3 },
    ],
    traits: [{ name: "TFT17_Timebreaker", num_units: 2, tier_current: 1 }],
  });
  const reordered = normalizeFinalBoard({
    setNumber: 17,
    gameVersion: "17.7.9",
    units: [
      { character_id: "tft17_ezreal", tier: 3 },
      { character_id: "tft17_riven", tier: 2, itemNames: ["item_a", "item_b"] },
    ],
    traits: [{ name: "tft17_timebreaker", activeTier: 1, count: 2 }],
  });

  assert.deepEqual(first.units.map((unit) => unit.unitId), [
    "tft17_ezreal",
    "tft17_riven",
  ]);
  assert.equal(first.boardFingerprint, reordered.boardFingerprint);
  assert.equal(first.contextFingerprint, reordered.contextFingerprint);
  assert.equal(first.boardSize, 2);
  assert.equal(first.patch, "17.7");
});

test("intrinsic and contextual fingerprints have separate semantics", () => {
  const baseInput = {
    setNumber: 17,
    units: [
      { character_id: "TFT17_Riven", tier: 2, itemNames: ["item_a"] },
      { character_id: "TFT17_Ezreal", tier: 3 },
    ],
    traits: [{ name: "TFT17_Timebreaker", num_units: 2, tier_current: 1 }],
  };
  const current = normalizeFinalBoard({ ...baseInput, patch: "17.7" });
  const previous = normalizeFinalBoard({ ...baseInput, patch: "17.6" });

  assert.equal(current.boardFingerprint, previous.boardFingerprint);
  assert.notEqual(current.contextFingerprint, previous.contextFingerprint);

  for (const changed of [
    normalizeFinalBoard({
      ...baseInput,
      units: [{ character_id: "TFT17_Riven", tier: 2, itemNames: ["item_a"] }],
      patch: "17.7",
    }),
    normalizeFinalBoard({
      ...baseInput,
      units: [
        { character_id: "TFT17_Riven", tier: 3, itemNames: ["item_a"] },
        baseInput.units[1],
      ],
      patch: "17.7",
    }),
    normalizeFinalBoard({
      ...baseInput,
      units: [
        { character_id: "TFT17_Riven", tier: 2, itemNames: ["item_b"] },
        baseInput.units[1],
      ],
      patch: "17.7",
    }),
    normalizeFinalBoard({
      ...baseInput,
      traits: [{ name: "TFT17_Timebreaker", num_units: 3, tier_current: 2 }],
      patch: "17.7",
    }),
  ]) {
    assert.notEqual(current.boardFingerprint, changed.boardFingerprint);
  }
});

test("invalid placements are normalized to missing rather than zero", () => {
  for (const placement of [0, 9, -1, 2.5, undefined]) {
    const payload = structuredClone(fixtures[0]);
    payload.metadata.match_id = `invalid-${placement}`;
    payload.info.participants[0].placement = placement;
    assert.equal(parseRiotMatchPayload(payload).participants[0].placement, null);
  }
});

test("optimizer-shaped candidates map local IDs, traits, and star plans", () => {
  const board = normalizeFinalBoard(
    {
      setNumber: 17,
      patch: "17.7",
      units: [{ id: "riven", cost: 4 }],
      starPlans: { riven: { starLevel: 2 } },
      activeTraits: [
        { name: "Timebreaker", count: 2, activeAt: 1, isActive: true },
      ],
    },
    {
      champions: [{ id: "riven", apiName: "TFT17_Riven", cost: 4 }],
      traits: [{ name: "Timebreaker", apiName: "TFT17_Timebreaker" }],
    },
  );

  assert.equal(board.units[0].unitId, "tft17_riven");
  assert.equal(board.units[0].starLevel, 2);
  assert.equal(board.activeTraits[0].traitId, "tft17_timebreaker");
  assert.equal(board.totalUnitCost, 4);
});

test("parser rejects malformed required boundaries", () => {
  assert.throws(() => parseRiotMatchPayload(null), /JSON object/);
  assert.throws(
    () => parseRiotMatchPayload({ metadata: {}, info: { participants: [] } }),
    /match_id/,
  );
  assert.throws(
    () => parseRiotMatchPayload({ metadata: { match_id: "x" }, info: {} }),
    /participants/,
  );
});

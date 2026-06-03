export const SPECIAL_SOURCE_TYPES = {
  MECHA_TRANSFORMER: "MECHA_TRANSFORMER",
  EMBLEM: "EMBLEM",
};

export function getSpecialTraitPlan({
  targetTrait,
  targetCount,
  boardSize,
  selectedUnits,
  transformedMechaIds = [],
  allowEmblems = true,
  maxEmblems = 0,
  allowMechaTransformer = true,
}) {
  if (targetTrait === "Mecha" && allowMechaTransformer) {
    return getMechaTransformerPlan({
      targetTrait,
      targetCount,
      boardSize,
      selectedUnits,
      transformedMechaIds,
    });
  }

  if (allowEmblems) {
    return getGenericEmblemPlan({
      targetTrait,
      targetCount,
      selectedUnits,
      maxEmblems,
    });
  }

  return emptySpecialPlan();
}

function emptySpecialPlan() {
  return {
    virtualTraits: {},
    extraBoardSlots: 0,
    specialSources: [],
    isPossible: true,
  };
}

function getGenericEmblemPlan({
  targetTrait,
  targetCount,
  selectedUnits,
  maxEmblems = 0,
}) {
  const naturalCount = selectedUnits.filter((unit) =>
    unit.traits.includes(targetTrait),
  ).length;

  const missing = Math.max(0, Number(targetCount || 0) - naturalCount);
  const allowedEmblems = Math.max(0, Number(maxEmblems || 0));

  const emblemsToUse = Math.min(missing, allowedEmblems);
  const stillMissing = missing - emblemsToUse;

  return {
    virtualTraits:
      emblemsToUse > 0
        ? {
            [targetTrait]: emblemsToUse,
          }
        : {},
    extraBoardSlots: 0,
    specialSources: Array.from({ length: emblemsToUse }, (_, index) => ({
      type: SPECIAL_SOURCE_TYPES.EMBLEM,
      trait: targetTrait,
      traitBonus: 1,
      boardSlots: 0,
      label: `${targetTrait} Emblem`,
      note: `${targetTrait} emblem/source #${index + 1}: +1 ${targetTrait}.`,
    })),
    isPossible: stillMissing <= 0,
    missingAfterSpecialSources: stillMissing,
  };
}

function getMechaTransformerPlan({
  targetTrait,
  targetCount,
  boardSize,
  selectedUnits,
  transformedMechaIds = [],
}) {
  const transformedSet = new Set(transformedMechaIds);

  const mechaUnits = selectedUnits.filter((unit) =>
    unit.traits.includes("Mecha"),
  );

  const manualHolders = mechaUnits.filter((unit) =>
    transformedSet.has(unit.id),
  );

  const naturalMechaCount = mechaUnits.length;
  const manualTransformerCount = manualHolders.length;

  const manualMechaCount = naturalMechaCount + manualTransformerCount;
  const manualExtraSlots = manualTransformerCount;

  const missingMecha = Math.max(0, Number(targetCount || 0) - manualMechaCount);

  const freeSlots = Math.max(
    0,
    Number(boardSize) - selectedUnits.length - manualExtraSlots,
  );

  const availableAutoHolders = mechaUnits.filter(
    (unit) => !transformedSet.has(unit.id),
  );

  const autoTransformersToUse = Math.min(
    missingMecha,
    availableAutoHolders.length,
    freeSlots,
  );

  const autoHolders = [...availableAutoHolders]
    .sort((a, b) => {
      return (
        (b.carryScore || 0) - (a.carryScore || 0) ||
        b.cost - a.cost ||
        a.name.localeCompare(b.name)
      );
    })
    .slice(0, autoTransformersToUse);

  const allHolders = [...manualHolders, ...autoHolders];

  const totalTransformerCount = allHolders.length;
  const totalMechaCount = naturalMechaCount + totalTransformerCount;
  const stillMissing = Math.max(0, Number(targetCount || 0) - totalMechaCount);

  return {
    virtualTraits:
      totalTransformerCount > 0 ? { Mecha: totalTransformerCount } : {},
    extraBoardSlots: totalTransformerCount,
    specialSources: allHolders.map((unit) => ({
      type: SPECIAL_SOURCE_TYPES.MECHA_TRANSFORMER,
      trait: "Mecha",
      holderId: unit.id,
      holderName: unit.name,
      traitBonus: 1,
      boardSlots: 1,
      effectiveTraitValue: 2,
      effectiveSlotValue: 2,
      manuallySelected: transformedSet.has(unit.id),
      label: "Mecha Transformer",
      note: `${unit.name} is transformed: counts as 2 Mecha and uses 2 board slots.`,
    })),
    isPossible: stillMissing <= 0,
    missingAfterSpecialSources: stillMissing,
  };
}

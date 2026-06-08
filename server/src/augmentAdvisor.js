import { tierToScore } from "./rules.js";

export function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getText(augment) {
  return `${augment?.name || ""} ${augment?.description || augment?.effect || ""} ${
    Array.isArray(augment?.tags) ? augment.tags.join(" ") : ""
  }`.toLowerCase();
}

export function enrichAugment(raw = {}) {
  const name = raw.name || raw.id || "Unknown Augment";
  const id = raw.id || normalizeKey(name);
  const iconSlug = raw.iconSlug || id;
  const description = raw.description || raw.effect || "";
  const text = `${name} ${description}`.toLowerCase();
  const tags = new Set(raw.tags || []);

  if (/gold|interest|econom|xp|level|health|tactician|shop|reroll|refresh|stage|combat loss|lose your combat|player combat/.test(text)) tags.add("econ");
  if (/reroll|refresh|shop|three-star|3-star|star up|duplicator|copy|copies|worth the wait|ticket|roll/.test(text)) tags.add("reroll");
  if (/xp|level|team size|max team size|level 9|level 10/.test(text)) tags.add("leveling");
  if (/damage amp|attack damage|ability power|attack speed|crit|critical|omnivamp|burn|mana regen|true damage|precision|shred|armor and magic resist|durability|shield|heal|health/.test(text)) tags.add("combat");
  if (/armor|magic resist|health|shield|heal|durability|front row|frontline|tank|dummy|dummies/.test(text)) tags.add("defensive");
  if (/damage amp|attack damage|ability power|attack speed|crit|critical|burn|true damage|precision|giant slayer|deathblade|rabadon|bow|sword|rod|glove/.test(text)) tags.add("offensive");
  if (/component|item|artifact|anvil|forge|glove|sword|bow|tear|belt|rod|spatula|frying pan|emblem|reforger/.test(text)) tags.add("items");
  if (/emblem|trait|bronze-tier|unique trait|same traits|active trait|last-listed trait/.test(text)) tags.add("trait");
  if (/random|transform|pandora|chaos|recombobulator|remove all champions|sell all units/.test(text)) tags.add("strategic");
  if (/ap|ability power|mana|rod|rabadon|archangel|jeweled|magic/.test(text)) tags.add("ap");
  if (/attack damage|attack speed|recurve|bow|sword|deathblade|guinsoo|physical|crit/.test(text)) tags.add("ad");

  const category = raw.category ||
    (tags.has("trait") ? "strategic" :
      tags.has("reroll") ? "reroll" :
      tags.has("items") ? "items" :
      tags.has("econ") ? "econ" :
      tags.has("combat") ? "combat" : "flex");

  return {
    ...raw,
    id,
    name,
    description,
    tier: Number(raw.tier || raw.augmentTier || 0) || 0,
    category,
    tags: [...tags],
    iconSlug,
    iconUrl:
      raw.iconUrl ||
      `https://cdn.mobalytics.gg/assets/tft/images/hextech-augments/set17/${iconSlug}.webp?v=5`,
  };
}

export function enrichAugments(augments = []) {
  return augments.map(enrichAugment);
}

function unitText(unit) {
  return `${unit?.name || ""} ${unit?.role || ""} ${(unit?.traits || []).join(" ")} ${unit?.ability?.desc || ""}`.toLowerCase();
}

function isFrontlineUnitLoose(unit) {
  const text = unitText(unit);
  const range = Number(unit?.stats?.range ?? unit?.range ?? 1);
  if (/tank|front|brawler|bastion|bruiser|vanguard|warden|guardian|sentinel|juggernaut|defender/.test(text)) return true;
  return range <= 1 && Number(unit?.stats?.hp || 0) >= 700;
}

function isCarryLike(unit) {
  return /carry|caster|damage|sniper|marksman|ad|ap|fighter|assassin|physical|magic/.test(unitText(unit));
}

function getCompShape({ units = [], carry, targetTrait, activeTraits = [] }) {
  const frontliners = units.filter(isFrontlineUnitLoose);
  const backliners = units.filter((unit) => Number(unit?.stats?.range ?? unit?.range ?? 1) >= 3);
  const carryText = unitText(carry);
  const carryCost = Number(carry?.cost || 0);
  const lowCostUnits = units.filter((unit) => Number(unit?.cost || 1) <= 2);
  const threeCostUnits = units.filter((unit) => Number(unit?.cost || 1) === 3);
  const fiveCostUnits = units.filter((unit) => Number(unit?.cost || 1) === 5);
  const carryTraits = new Set(carry?.traits || []);
  const activeTraitNames = new Set((activeTraits || []).filter((t) => t.isActive).map((t) => t.name));
  const activeTraitCount = activeTraitNames.size;
  const isRerollShape =
    carryCost > 0 && carryCost <= 3 ||
    lowCostUnits.length >= 3 ||
    threeCostUnits.length >= 3;
  const isFastNineShape = fiveCostUnits.length >= 2 || units.length >= 9;

  return {
    frontliners,
    backliners,
    carryText,
    carryCost,
    lowCostUnits,
    threeCostUnits,
    fiveCostUnits,
    carryTraits,
    activeTraitNames,
    activeTraitCount,
    isRerollShape,
    isFastNineShape,
    targetTrait,
    hasAPCarry: /ap|caster|magic|ability power|mana|spell/.test(carryText),
    hasADCarry: /ad|marksman|sniper|attack damage|attack speed|physical|crit|attack fighter/.test(carryText),
    hasMeleeCarry: Number(carry?.stats?.range ?? carry?.range ?? 1) <= 1,
    hasManyBackliners: backliners.length >= 4,
    hasManyFrontliners: frontliners.length >= 3,
  };
}

function addReason(reasons, condition, reason) {
  if (condition) reasons.push(reason);
}

export function scoreAugmentForComp(augment, context = {}) {
  const enriched = enrichAugment(augment);
  const text = getText(enriched);
  const shape = getCompShape(context);
  const playStyle = context.playStyle || "first";
  const gameModeId = context.gameModeId || context.gameMode?.id || "capped";
  const selectedComponents = context.components || [];
  const hp = Number(context.hp || 0);
  const stage = String(context.stage || "");
  const reasons = [];

  let score = 50 + Number(enriched.baseScore || 0);
  if (enriched.tier === 3) score += 4;
  if (enriched.tier === 2) score += 2;

  const tags = new Set(enriched.tags || []);

  if (shape.targetTrait && text.includes(shape.targetTrait.toLowerCase())) {
    score += 42;
    reasons.push(`Directly mentions ${shape.targetTrait}.`);
  }

  for (const trait of shape.carryTraits) {
    if (text.includes(String(trait).toLowerCase())) {
      score += 26;
      reasons.push(`Supports the carry trait ${trait}.`);
    }
  }

  for (const trait of shape.activeTraitNames) {
    if (shape.targetTrait && trait === shape.targetTrait) continue;
    if (text.includes(String(trait).toLowerCase())) {
      score += 14;
      reasons.push(`Mentions active trait ${trait}.`);
    }
  }

  for (const unit of context.units || []) {
    const unitName = String(unit?.name || "").toLowerCase();
    if (!unitName || !text.includes(unitName)) continue;

    if (unit.id === context.carry?.id) {
      score += 48;
      reasons.push(`Directly supports your carry ${unit.name}.`);
    } else {
      score += 24;
      reasons.push(`Gives or supports board unit ${unit.name}.`);
    }
  }

  if (tags.has("trait")) {
    score += shape.activeTraitCount >= 5 ? 18 : 8;
    addReason(reasons, shape.activeTraitCount >= 5, "Your board has many active traits, so trait-scaling augments get better.");
  }

  if (tags.has("reroll")) {
    if (shape.isRerollShape || gameModeId === "early" || gameModeId === "mid") {
      score += 24;
      reasons.push("Fits a reroll / upgrade-heavy board shape.");
    } else {
      score -= playStyle === "first" ? 28 : 16;
      reasons.push("Reroll value is lower if you are trying to cap around expensive units.");
    }
  }

  if (tags.has("leveling")) {
    if (shape.isFastNineShape || playStyle === "first" || gameModeId === "capped") {
      score += 24;
      reasons.push("Helps you reach a higher capped board for first place.");
    } else {
      score += 8;
    }
  }

  if (tags.has("econ")) {
    if (/2-|2-1|stage 2|early/.test(stage) || gameModeId === "early" || gameModeId === "mid") {
      score += 16;
      reasons.push("Early econ can convert into stronger level/roll timing later.");
    } else if (playStyle === "first" && (shape.isFastNineShape || gameModeId === "capped")) {
      score += 10;
      reasons.push("Econ is still useful if it helps you reach level 9/10.");
    } else {
      score -= 6;
      reasons.push("Pure econ is less valuable once you must stabilize immediately.");
    }
  }

  if (tags.has("combat")) {
    score += playStyle === "first" ? 18 : 10;
    reasons.push("Combat power is usually safer when playing for first and capping the board.");
  }

  if (tags.has("defensive")) {
    if (shape.frontliners.length < Number(context.minFrontline || 2) || shape.hasManyBackliners) {
      score += 18;
      reasons.push("Your board wants more time for backline carries to cast/deal damage.");
    } else {
      score += 8;
    }
  }

  if (tags.has("offensive")) {
    if (shape.hasAPCarry || shape.hasADCarry || isCarryLike(context.carry)) {
      score += 14;
      reasons.push("Your carry can convert offensive stats into board strength.");
    }
  }

  if (tags.has("ap") && shape.hasAPCarry) {
    score += 18;
    reasons.push("AP/caster carry fit.");
  }

  if (tags.has("ad") && shape.hasADCarry) {
    score += 18;
    reasons.push("AD/attack-speed carry fit.");
  }

  if (tags.has("items")) {
    score += selectedComponents.length ? 10 : 4;
    reasons.push("Item economy/flexibility helps convert components into a playable spike.");
  }

  if (/stand united|bronze for life/i.test(enriched.name) && shape.activeTraitCount >= 5) {
    score += 20;
    reasons.push("Trait soup board makes this scaling augment stronger.");
  }

  if (/tiny titans|tiniest titan|risky moves|nine lives|comeback/.test(text) && hp > 0 && hp <= 45) {
    score += 22;
    reasons.push("Low HP makes health/comeback augments more valuable.");
  }

  if (/pandora/.test(text) && selectedComponents.length >= 2) {
    score += 14;
    reasons.push("Pandora-style item fixing is stronger when you already have awkward components.");
  }

  if (/clear mind|cluttered mind/.test(text) && gameModeId !== "capped") {
    score += 10;
    reasons.push("XP economy augments are strongest before you are locked into a capped board.");
  }

  if (/cursed crown/.test(text) && hp > 0 && hp < 55) {
    score -= 22;
    reasons.push("Dangerous at low HP because losses hurt more.");
  }

  return {
    augment: enriched,
    score: Math.round(score),
    reasons: reasons.slice(0, 4),
  };
}

export function getAugmentAdvice({
  augments = [],
  selectedAugmentIds = [],
  offeredAugmentIds = [],
  units = [],
  carry = null,
  activeTraits = [],
  targetTrait = null,
  minFrontline = 0,
  components = [],
  playStyle = "first",
  gameModeId = "capped",
  hp = null,
  stage = null,
} = {}) {
  const enriched = enrichAugments(augments);
  const byId = new Map(enriched.map((augment) => [augment.id, augment]));
  const selected = selectedAugmentIds.map((id) => byId.get(id)).filter(Boolean);
  const offeredPool = offeredAugmentIds.length
    ? offeredAugmentIds.map((id) => byId.get(id)).filter(Boolean)
    : enriched.filter((augment) => !selectedAugmentIds.includes(augment.id));

  const context = {
    units,
    carry,
    activeTraits,
    targetTrait,
    minFrontline,
    components,
    playStyle,
    gameModeId,
    hp,
    stage,
  };

  const selectedFit = selected.map((augment) => scoreAugmentForComp(augment, context));
  const selectedScore = selectedFit.reduce((sum, entry) => sum + (entry.score - 50), 0);
  const recommendations = offeredPool
    .map((augment) => scoreAugmentForComp(augment, context))
    .sort((a, b) => b.score - a.score || a.augment.name.localeCompare(b.augment.name))
    .slice(0, offeredAugmentIds.length ? offeredAugmentIds.length : 8);

  const warnings = [];
  const selectedBad = selectedFit.filter((entry) => entry.score < 48);
  if (selectedBad.length) {
    warnings.push(
      `Low augment fit: ${selectedBad.map((entry) => entry.augment.name).join(", ")}. Consider pivoting board or not over-forcing this comp.`,
    );
  }

  return {
    selected: selectedFit,
    selectedScore: Math.round(selectedScore),
    offeredCount: offeredAugmentIds.length,
    recommendations,
    warnings,
  };
}

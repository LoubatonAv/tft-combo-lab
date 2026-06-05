import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles,
  Shield,
  Sword,
  Star,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import "./styles.css";
const MECHA_TRANSFORMER_TOOL = "MECHA_TRANSFORMER";

function isMechaUnit(unit) {
  return unit?.traits?.includes("Mecha");
}
function getBoardSlotValue(unit, upgradedMechaIds = new Set()) {
  if (isMechaUnit(unit) && upgradedMechaIds.has(unit.id)) {
    return 2;
  }

  return 1;
}

function getTraitContribution(unit, traitName, upgradedMechaIds = new Set()) {
  if (!unit?.traits?.includes(traitName)) return 0;

  if (traitName === "Mecha" && upgradedMechaIds.has(unit.id)) {
    return 2;
  }

  return 1;
}

function getBoardSlotsUsed(units, upgradedMechaIds = new Set()) {
  return units.reduce((sum, unit) => {
    return sum + getBoardSlotValue(unit, upgradedMechaIds);
  }, 0);
}

const FRONTLINE_TRAITS = new Set([
  "Brawler",
  "Vanguard",
  "Bastion",
  "Bruiser",
  "Defender",
  "Protector",
  "Warden",
  "Guardian",
  "Sentinel",
  "Juggernaut",
  "Tank",
]);

function getUnitRange(unit) {
  return Number(unit?.stats?.range ?? unit?.range ?? 1);
}

function getUnitTankinessScore(unit) {
  const stats = unit?.stats || {};

  return (
    Number(stats.hp || 0) / 80 +
    Number(stats.armor || 0) / 3 +
    Number(stats.magicResist || 0) / 3
  );
}

function isCarryLikeUnit(unit) {
  return /carry|caster|assassin|damage|sniper|marksman|ad|ap/i.test(
    unit?.role || "",
  );
}

function abilityMentionsDamage(unit) {
  const desc = String(unit?.ability?.desc || "").toLowerCase();

  return (
    desc.includes("physicaldamage") ||
    desc.includes("magicdamage") ||
    desc.includes("truedamage") ||
    /\bdeal\b.*\bdamage\b/i.test(desc)
  );
}

function isCarryCandidateUnit(unit) {
  const role = String(unit?.role || "").toLowerCase();
  const carryScore = Number(unit?.carryScore || 0);
  const cost = Number(unit?.cost || 1);
  const stats = unit?.stats || {};
  const range = Number(stats.range ?? unit?.range ?? 1);
  const damage = Number(stats.damage || 0);
  const attackSpeed = Number(stats.attackSpeed || 0);

  if (/carry|caster|assassin|damage|sniper|marksman|ad|ap/i.test(role)) {
    return true;
  }

  if (role.includes("flex") && carryScore >= 60) {
    return true;
  }

  if (carryScore >= 75) {
    return true;
  }

  if (abilityMentionsDamage(unit) && carryScore >= 55) {
    return true;
  }

  if (
    abilityMentionsDamage(unit) &&
    cost >= 3 &&
    (damage > 0 || attackSpeed >= 0.7)
  ) {
    return true;
  }

  if (range >= 3 && damage > 0 && attackSpeed >= 0.65) {
    return true;
  }

  return false;
}

function isFrontlineUnit(unit) {
  const role = String(unit?.role || "").toLowerCase();

  if (/tank|front|defender|bruiser|fighter/.test(role)) return true;

  const hasFrontlineTrait = (unit?.traits || []).some((trait) =>
    FRONTLINE_TRAITS.has(trait),
  );

  if (!hasFrontlineTrait) return false;

  // Do not count ranged/carry Brawlers such as Urgot as true frontline unless
  // their role or durability clearly says so.
  if (isCarryLikeUnit(unit) && getUnitRange(unit) > 1) return false;

  return getUnitRange(unit) <= 1 || getUnitTankinessScore(unit) >= 42;
}

function countFrontlineUnits(units) {
  return units.filter((unit) => isFrontlineUnit(unit)).length;
}

const GAME_MODES = {
  early: {
    id: "early",
    label: "Early",
    defaultBoardSize: 5,
    maxUnitCost: 2,
  },
  mid: {
    id: "mid",
    label: "Mid",
    defaultBoardSize: 7,
    maxUnitCost: 3,
  },
  late: {
    id: "late",
    label: "Late",
    defaultBoardSize: 8,
    maxUnitCost: 4,
  },
  capped: {
    id: "capped",
    label: "Capped",
    defaultBoardSize: 10,
    maxUnitCost: 5,
  },
};

function countBoardTraits(units, upgradedMechaIds = new Set()) {
  const counts = {};

  for (const unit of units) {
    for (const trait of unit.traits || []) {
      counts[trait] =
        (counts[trait] || 0) +
        getTraitContribution(unit, trait, upgradedMechaIds);
    }
  }

  return counts;
}

function getTraitRowsFromBoard(units, upgradedMechaIds, traitsConfig) {
  const counts = countBoardTraits(units, upgradedMechaIds);

  return Object.entries(counts)
    .map(([name, count]) => {
      const cfg = traitsConfig.find((t) => t.name === name) || {
        breakpoints: [],
      };
      const isUnique =
        Boolean(cfg.isUnique) ||
        String(cfg.type || "").toLowerCase() === "unique";
      const breakpoints = [...(cfg.breakpoints || [])].sort((a, b) => a - b);

      const activeAt = isUnique
        ? count >= 1
          ? 1
          : 0
        : [...breakpoints].reverse().find((bp) => count >= bp) || 0;

      const nextBreakpoint = isUnique
        ? null
        : breakpoints.find((bp) => count < bp) || null;

      return {
        name,
        count,
        activeAt,
        nextBreakpoint,
        isUnique,
        isActive: Boolean(activeAt),
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        (b.activeAt || 0) - (a.activeAt || 0),
    );
}

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function costColor(cost) {
  return (
    {
      5: "border-amber-300/80 bg-amber-400/12 shadow-amber-900/20",
      4: "border-purple-300/80 bg-purple-500/12 shadow-purple-900/20",
      3: "border-sky-300/80 bg-sky-500/12 shadow-sky-900/20",
      2: "border-emerald-300/75 bg-emerald-500/12 shadow-emerald-900/20",
      1: "border-slate-400/70 bg-slate-500/12 shadow-slate-900/20",
    }[Number(cost)] || "border-slate-500/50 bg-slate-500/10"
  );
}

function costBadge(cost) {
  return (
    {
      5: "bg-amber-300 text-amber-950",
      4: "bg-purple-300 text-purple-950",
      3: "bg-sky-300 text-sky-950",
      2: "bg-emerald-300 text-emerald-950",
      1: "bg-slate-300 text-slate-950",
    }[Number(cost)] || "bg-slate-300 text-slate-950"
  );
}

function isUniqueTrait(trait) {
  return (
    Boolean(trait?.isUnique) ||
    ((trait?.breakpoints || []).length === 1 &&
      trait.breakpoints[0] === 1 &&
      String(trait?.type || "").toLowerCase() === "unique")
  );
}

function defaultTargetCount(trait, boardSize) {
  if (!trait) return Math.min(6, boardSize);
  if (isUniqueTrait(trait)) return 1;

  const breakpoints = [...(trait.breakpoints || [])]
    .filter((bp) => bp <= boardSize)
    .sort((a, b) => a - b);

  return breakpoints.at(-1) || Math.min(1, boardSize);
}

function formatTraitProgress(trait) {
  if (!trait?.name) return "";

  if (trait.isUnique) {
    return trait.isActive ? `${trait.name} Unique` : `${trait.name}`;
  }

  const emblemText = trait.emblemCount
    ? ` +${trait.emblemCount} emblem${trait.emblemCount === 1 ? "" : "s"}`
    : "";

  if (trait.targetCount > 0) {
    return `${trait.name} ${trait.count}/${trait.targetCount}${emblemText}`;
  }

  if (trait.activeAt > 0) {
    return `${trait.name} ${trait.count} · active ${trait.activeAt}${emblemText}`;
  }

  return `${trait.name} ${trait.count}${emblemText}`;
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

const CHAMPION_IMAGE_ALIASES = {
  "Aurelion Sol": "AurelionSol",
  Chogath: "Chogath",
  Kaisa: "Kaisa",
  Leblanc: "Leblanc",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  Nunu: "Nunu",
  RekSai: "RekSai",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  Belveth: "Belveth",
  Rhaast: "Kayn",
};

const SPECIAL_TFT_IMAGE_URLS = {
  Meepsie:
    "https://raw.communitydragon.org/latest/game/assets/ux/tft/championsplashes/tft3_bardmeep.png",
  "The Mighty Mech":
    "https://raw.communitydragon.org/latest/game/assets/ux/tft/championsplashes/tft3_supermech.png",
};

function ddragonAlias(unit) {
  return (
    CHAMPION_IMAGE_ALIASES[unit.name] ||
    unit.imageName ||
    unit.name.replace(/[^a-zA-Z0-9]/g, "")
  );
}

function championImageUrls(unit) {
  if (unit.imageUrl) return [unit.imageUrl];

  const urls = [];

  if (SPECIAL_TFT_IMAGE_URLS[unit.name]) {
    urls.push(SPECIAL_TFT_IMAGE_URLS[unit.name]);
  }

  const alias = ddragonAlias(unit);

  urls.push(
    `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${alias}_0.jpg`,
  );
  urls.push(
    `https://raw.communitydragon.org/latest/game/assets/ux/tft/championsplashes/tft3_${alias.toLowerCase()}_mobile.png`,
  );
  urls.push(
    `https://raw.communitydragon.org/latest/game/assets/ux/tft/championsplashes/tft3_${alias.toLowerCase()}.png`,
  );

  return [...new Set(urls)];
}

function ChampionPortrait({ unit, size = "md", className = "" }) {
  const [imageIndex, setImageIndex] = useState(0);
  const urls = championImageUrls(unit);
  const src = urls[imageIndex];

  const sizes = {
    sm: "h-10 w-10 rounded-xl text-xl",
    md: "h-14 w-14 rounded-2xl text-3xl",
    board: "h-full w-full rounded-2xl text-2xl",
  };

  if (!src) {
    return (
      <div
        className={cx(
          "flex items-center justify-center bg-black/25",
          sizes[size],
          className,
        )}
      >
        {unit.icon || "?"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={unit.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setImageIndex((i) =>
          i + 1 < urls.length ? i + 1 : Number.POSITIVE_INFINITY,
        );
      }}
      className={cx(
        "object-cover shadow-lg ring-1 ring-white/10",
        sizes[size],
        className,
      )}
    />
  );
}

function TraitIcon({ trait, size = "sm", className = "" }) {
  const sizes = {
    sm: "h-9 w-9",
    md: "h-12 w-12",
  };

  if (!trait?.imageUrl) {
    return (
      <div
        className={cx(
          "flex items-center justify-center rounded-xl bg-black/30 text-xs font-black",
          sizes[size],
          className,
        )}
      >
        {trait?.name?.slice(0, 2) || "?"}
      </div>
    );
  }

  return (
    <img
      src={trait.imageUrl}
      alt={trait.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cx(
        "rounded-xl object-cover ring-1 ring-white/10",
        sizes[size],
        className,
      )}
    />
  );
}

function getFallbackItemsForUnit(unit) {
  const role = String(unit?.role || "").toLowerCase();
  const traits = (unit?.traits || []).join(" ").toLowerCase();
  const text = `${role} ${traits}`;

  if (/tank|bastion|brawler|vanguard/.test(text)) {
    return ["Gargoyle Stoneplate", "Warmog's Armor", "Dragon's Claw"];
  }

  if (/ad|sniper|marauder|rogue|challenger|physical/.test(text)) {
    return ["Infinity Edge", "Last Whisper", "Deathblade"];
  }

  if (/fighter|duelist/.test(text)) {
    return ["Bloodthirster", "Titan's Resolve", "Sterak's Gage"];
  }

  if (/ap|conduit|oracle|psionic|magic|caster/.test(text)) {
    return ["Spear of Shojin", "Jeweled Gauntlet", "Rabadon's Deathcap"];
  }

  return ["Guardbreaker", "Giant Slayer", "Hand of Justice"];
}

function normalizeItemSet(set, index = 0) {
  const items = Array.isArray(set?.items)
    ? set.items.filter(Boolean)
    : Array.isArray(set)
      ? set.filter(Boolean)
      : [];

  return {
    id: set?.id || `item-set-${index}`,
    items,
    tier: set?.tier || null,
    avgPlace: set?.avgPlace ?? null,
    winRate: set?.winRate ?? null,
    top4Rate: set?.top4Rate ?? null,
    games: set?.games ?? null,
    playRate: set?.playRate ?? null,
    source: set?.source || null,
  };
}

function scoreItemSet(set) {
  return (
    Number(set?.score || 0) ||
    Number(set?.winRate || 0) * 2 -
      Number(set?.avgPlace || 4.5) * 10 +
      Math.min(Number(set?.games || 0) / 100, 12)
  );
}

function getLegacyBestItemsForUnit(unit, itemStats = {}) {
  const directStats = itemStats?.[unit.id] || itemStats?.[unit.apiName] || [];

  if (Array.isArray(directStats) && directStats.length > 0) {
    return directStats
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .map((entry) => entry.item || entry.name)
      .filter(Boolean)
      .slice(0, 3);
  }

  const importedItems = Array.isArray(unit.items)
    ? unit.items.filter(Boolean).slice(0, 3)
    : [];

  return importedItems.length ? importedItems : getFallbackItemsForUnit(unit);
}

function getBestItemSetsForUnit(unit, itemSetStats = {}, itemStats = {}) {
  const directSets =
    itemSetStats?.[unit.id] || itemSetStats?.[unit.apiName] || [];

  if (Array.isArray(directSets) && directSets.length > 0) {
    return directSets
      .map(normalizeItemSet)
      .filter((set) => set.items.length > 0)
      .sort((a, b) => scoreItemSet(b) - scoreItemSet(a))
      .slice(0, 3);
  }

  const items = getLegacyBestItemsForUnit(unit, itemStats);

  return items.length
    ? [
        {
          id: `legacy-${unit.id}`,
          items,
          tier: null,
          avgPlace: null,
          winRate: null,
          top4Rate: null,
          games: null,
          playRate: null,
          source: "legacy-itemStats",
        },
      ]
    : [];
}

function getBestItemsForUnit(unit, itemStats = {}, itemSetStats = {}) {
  const bestSet = getBestItemSetsForUnit(unit, itemSetStats, itemStats)[0];

  if (bestSet?.items?.length) {
    return bestSet.items.slice(0, 3);
  }

  return getLegacyBestItemsForUnit(unit, itemStats);
}

function normalizeItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function getItemCatalogEntry(itemName, itemCatalog = {}) {
  const direct = itemCatalog?.[itemName];
  if (direct) return direct;

  const normalized = normalizeItemName(itemName);

  return (
    Object.entries(itemCatalog || {}).find(
      ([name]) => normalizeItemName(name) === normalized,
    )?.[1] || {}
  );
}

function getItemImageCandidates(item, details = {}) {
  const itemIdMap = {
    "Adaptive Helm": "3190",
    "Archangel's Staff": "3003",
    Bloodthirster: "3072",
    "Blue Buff": "3124",
    "Bramble Vest": "3075",
    Crownguard: "4644",
    Deathblade: "6676",
    "Dragon's Claw": "3065",
    "Edge of Night": "3814",
    Evenshroud: "3001",
    "Gargoyle Stoneplate": "3193",
    "Giant Slayer": "3036",
    Guardbreaker: "4633",
    "Guinsoo's Rageblade": "3124",
    "Hand of Justice": "3094",
    "Hand Of Justice": "3094",
    "Hextech Gunblade": "3146",
    "Infinity Edge": "3031",
    "Ionic Spark": "8020",
    "Jeweled Gauntlet": "3135",
    "Kraken's Fury": "6672",
    "Last Whisper": "3035",
    Morellonomicon: "3165",
    "Nashor's Tooth": "3115",
    "Protector's Vow": "3109",
    Quicksilver: "3140",
    "Rabadon's Deathcap": "3089",
    "Red Buff": "3071",
    Redemption: "3107",
    "Spear of Shojin": "3161",
    "Spirit Visage": "3065",
    "Sterak's Gage": "3053",
    "Striker's Flail": "6692",
    "Sunfire Cape": "3068",
    "Thief's Gloves": "3095",
    "Titan's Resolve": "3742",
    "Void Staff": "3135",
    "Warmog's Armor": "3083",
  };

  const version = "15.24.1";
  const candidates = [];

  if (details.iconUrl) {
    candidates.push(details.iconUrl);
  }

  const itemId = itemIdMap[item];

  if (itemId) {
    candidates.push(
      `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`,
    );
  }

  return [...new Set(candidates)];
}

function ItemIcon({ item, itemCatalog = {}, size = "md" }) {
  const [urlIndex, setUrlIndex] = useState(0);

  const details = getItemCatalogEntry(item, itemCatalog);
  const components = details.components || [];
  const candidates = getItemImageCandidates(item, details);
  const currentUrl = candidates[urlIndex];

  const sizes = {
    sm: "h-9 w-9 rounded-lg",
    md: "h-11 w-11 rounded-xl",
  };

  const fallbackSizes = {
    sm: "min-h-9 min-w-28 rounded-lg px-2 py-1 text-[11px]",
    md: "min-h-11 min-w-32 rounded-xl px-2 py-1 text-xs",
  };

  const tooltip = (
    <div className="pointer-events-none fixed z-[9999] mt-2 hidden w-72 rounded-2xl border border-cyan-300/40 bg-slate-950 px-4 py-3 text-left text-sm text-slate-100 opacity-100 shadow-2xl ring-1 ring-black/80 group-hover:block">
      {/* תוכן ה-Tooltip נשאר אותו דבר */}
      <div className="text-base font-black text-white">{item}</div>
      <div className="mt-2 text-xs font-bold uppercase tracking-wide text-cyan-200">
        Components
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-100">
        {components.length ? components.join(" + ") : "No component data"}
      </div>
    </div>
  );

  if (!currentUrl || urlIndex >= candidates.length) {
    return (
      <span
        className={cx(
          "group relative inline-flex items-center justify-center border border-white/15 bg-slate-950 text-center font-black leading-tight text-cyan-100 shadow-lg",
          fallbackSizes[size],
        )}
        title={item}
      >
        {item}
        {tooltip}
      </span>
    );
  }

  return (
    <span className="group relative inline-flex">
      <img
        src={currentUrl}
        alt={item}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          if (urlIndex < candidates.length - 1) {
            setUrlIndex((current) => current + 1);
          } else {
            setUrlIndex(candidates.length);
          }
        }}
        className={cx(
          "object-cover ring-1 ring-white/15 shadow-lg",
          sizes[size],
        )}
      />

      {tooltip}
    </span>
  );
}

function ItemIconRow({ items = [], itemCatalog = {}, size = "md" }) {
  if (!items.length) {
    return <span className="text-xs text-slate-500">No item data yet</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <ItemIcon
          key={`${item}-${index}`}
          item={item}
          itemCatalog={itemCatalog}
          size={size}
        />
      ))}
    </div>
  );
}

function ItemSetList({ itemSets = [], itemCatalog = {}, compact = false }) {
  if (!itemSets.length) {
    return <span className="text-xs text-slate-500">No item set data yet</span>;
  }

  return (
    <div className="space-y-2">
      {itemSets.map((set, index) => {
        const normalizedSet = normalizeItemSet(set, index);

        return (
          <div
            key={normalizedSet.id}
            className="rounded-2xl border border-white/10 bg-black/20 p-2"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
              <div className="font-black text-cyan-100">
                Set {index + 1}
                {normalizedSet.tier ? ` · ${normalizedSet.tier}` : ""}
              </div>

              <div className="flex flex-wrap gap-1">
                {normalizedSet.winRate != null && (
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                    WR {normalizedSet.winRate}%
                  </span>
                )}

                {normalizedSet.avgPlace != null && (
                  <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
                    Avg {normalizedSet.avgPlace}
                  </span>
                )}

                {normalizedSet.games != null && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5">
                    {normalizedSet.games} games
                  </span>
                )}
              </div>
            </div>

            <ItemIconRow
              items={normalizedSet.items}
              itemCatalog={itemCatalog}
              size={compact ? "sm" : "md"}
            />
          </div>
        );
      })}
    </div>
  );
}

function ItemSetInfoCard({ icon, title, itemSets, itemCatalog = {} }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
      <div className="mb-3 flex items-center gap-2 font-black text-cyan-100">
        {icon}
        {title}
      </div>

      <ItemSetList itemSets={itemSets} itemCatalog={itemCatalog} />
    </div>
  );
}

function chooseDisplayCarry(units = [], itemStats = {}, itemSetStats = {}) {
  const carryLike = units.filter((unit) => isCarryCandidateUnit(unit));
  const pool = carryLike.length ? carryLike : units;

  return (
    [...pool].sort((a, b) => {
      const aItems = Array.isArray(itemStats[a.id])
        ? itemStats[a.id].length
        : 0;
      const bItems = Array.isArray(itemStats[b.id])
        ? itemStats[b.id].length
        : 0;
      const aSets = Array.isArray(itemSetStats[a.id])
        ? itemSetStats[a.id].length
        : 0;
      const bSets = Array.isArray(itemSetStats[b.id])
        ? itemSetStats[b.id].length
        : 0;

      return (
        Number(b.carryScore || 0) +
        bItems * 7 +
        bSets * 14 +
        Number(b.cost || 0) * 5 -
        (Number(a.carryScore || 0) +
          aItems * 7 +
          aSets * 14 +
          Number(a.cost || 0) * 5)
      );
    })[0] || null
  );
}

function buildImportedComp({
  units,
  traitsConfig,
  itemStats,
  itemSetStats,
  unitUpgradeMeta = {},
  parseResult,
}) {
  const activeTraits = getTraitRowsFromBoard(
    units,
    new Set(),
    traitsConfig || [],
  );
  const carry = chooseDisplayCarry(units, itemStats, itemSetStats);
  const score = Math.max(
    1,
    Math.round(
      activeTraits.filter((trait) => trait.isActive).length * 35 +
        units.length * 8,
    ),
  );

  return {
    id: `imported-${Date.now()}`,
    label: `Imported ${parseResult?.setId || "TFT"} team code`,
    score,
    units,
    carry,
    activeTraits,
    starPlans: Object.fromEntries(
      units.map((unit) => {
        const meta =
          unitUpgradeMeta?.[unit.id] || unitUpgradeMeta?.[unit.apiName] || {};
        return [
          unit.id,
          {
            starLevel: Number(
              meta.recommendedStarLevel ||
                (Number(unit.cost || 1) <= 4 ? 2 : 1),
            ),
            label:
              meta.label ||
              (Number(unit.cost || 1) <= 4
                ? "2★ expected"
                : "1★ expected / 2★ luxury"),
            source: meta.source || "local",
          },
        ];
      }),
    ),
    lockedUnitIds: units.map((unit) => unit.id),
    gameMode: null,
    boardSlotsUsed: units.length,
    specialSources: [],
    carryFit: {},
    itemPlan: {
      items: carry ? getBestItemsForUnit(carry, itemStats, itemSetStats) : [],
      score: 0,
    },
    primaryTrait: {
      name: null,
      count: 0,
      naturalCount: 0,
      specialCount: 0,
      targetCount: 0,
      activeAt: 0,
      nextBreakpoint: null,
      isUnique: false,
    },
    emblemPlan: null,
    reasons: [
      "Loaded from a pasted TFT Team Planner code.",
      "Press Optimize if you want the solver to improve or complete this board.",
    ],
    warnings: parseResult?.duplicateUnits?.length
      ? [
          `Duplicate units were skipped because this app keeps one copy per champion: ${parseResult.duplicateUnits
            .map((unit) => unit.name)
            .join(", ")}.`,
        ]
      : [],
  };
}

function EmblemTray({ traitsConfig = [] }) {
  const emblems = traitsConfig
    .filter((trait) => !isUniqueTrait(trait))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3">
      <div className="mb-3">
        <div className="text-sm font-black text-amber-100">Emblems</div>
        <div className="text-xs text-amber-100/75">
          Drag an emblem onto a unit to add or remove that trait manually on the
          board.
        </div>
      </div>

      <div className="flex max-h-32 flex-wrap gap-2 overflow-auto pr-1">
        {emblems.map((trait) => (
          <button
            key={trait.name}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", `EMBLEM:${trait.name}`);
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-2 py-2 text-xs text-amber-100 hover:bg-amber-300/20"
            title={`Drag ${trait.name} Emblem`}
          >
            <TraitIcon trait={trait} />
            <span className="font-bold">{trait.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lockedUnitIds, setLockedUnitIds] = useState([]);
  const [preTransformedMechaIds, setPreTransformedMechaIds] = useState([]);
  const [targetTrait, setTargetTrait] = useState("");
  const [targetCount, setTargetCount] = useState(0);
  const [boardSize, setBoardSize] = useState(8);
  const [carryId, setCarryId] = useState("auto");
  const [maxResults, setMaxResults] = useState(12);
  const [minFrontline, setMinFrontline] = useState(2);
  const [maxEmblems, setMaxEmblems] = useState(0);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gameModeId, setGameModeId] = useState("capped");
  const [maxUnitCost, setMaxUnitCost] = useState(5);
  const [allowEmblems, setAllowEmblems] = useState(false);
  const [allowMechaTransformer, setAllowMechaTransformer] = useState(false);

  async function loadData() {
    try {
      setError("");

      const res = await fetch(`${API}/api/data`);

      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }

      const json = await res.json();

      setData(json);

      setTargetTrait("");
      setTargetCount(0);
    } catch (e) {
      setError(e.message || "Failed to load data");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const selectedTraitConfig = useMemo(() => {
    return data?.traits.find((t) => t.name === targetTrait) || null;
  }, [data, targetTrait]);

  const naturalTraitCount = useMemo(() => {
    if (!data) return 0;

    return data.champions.filter((c) => c.traits.includes(targetTrait)).length;
  }, [data, targetTrait]);

  const targetCountOptions = useMemo(() => {
    if (!selectedTraitConfig) return [];

    if (isUniqueTrait(selectedTraitConfig)) return [1];

    return Array.from({ length: Number(boardSize) }, (_, i) => i + 1);
  }, [selectedTraitConfig, boardSize]);

  const carryOptions = useMemo(() => {
    if (!data) return [];

    const lockedSet = new Set(lockedUnitIds);

    const coreFirst = data.champions.filter((champ) => lockedSet.has(champ.id));
    const carries = data.champions.filter((champ) =>
      isCarryCandidateUnit(champ),
    );

    const byId = new Map(
      [...coreFirst, ...carries].map((champ) => [champ.id, champ]),
    );

    return [...byId.values()].sort((a, b) => {
      const lockedDelta =
        Number(lockedSet.has(b.id)) - Number(lockedSet.has(a.id));
      if (lockedDelta) return lockedDelta;

      return b.cost - a.cost || a.name.localeCompare(b.name);
    });
  }, [data, lockedUnitIds]);

  async function importTeamPlannerCode(code) {
    setError("");

    const response = await fetch(`${API}/api/parse-team-planner-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(json.error || `API error ${response.status}`);
    }

    const units = (json.unitIds || [])
      .map((id) => data.champions.find((champion) => champion.id === id))
      .filter(Boolean);

    if (!units.length) {
      throw new Error("No local champions matched this team code.");
    }

    setLockedUnitIds(units.map((unit) => unit.id));
    setPreTransformedMechaIds([]);
    setTargetTrait("");
    setTargetCount(0);
    setBoardSize(Math.max(2, Math.min(10, units.length)));
    setMaxUnitCost(Math.max(...units.map((unit) => Number(unit.cost || 1))));
    setCarryId("auto");

    const importedComp = buildImportedComp({
      units,
      traitsConfig: data.traits,
      itemStats: data.itemStats || {},
      itemSetStats: data.itemSetStats || {},
      unitUpgradeMeta: data.unitUpgradeMeta || {},
      parseResult: json,
    });

    setResults([importedComp]);
    setSelected(importedComp);

    const duplicateText = json.duplicateUnits?.length
      ? ` Skipped duplicate: ${json.duplicateUnits.map((unit) => unit.name).join(", ")}.`
      : "";
    const unresolvedText = json.unresolvedCodes?.length
      ? ` Unresolved slots: ${json.unresolvedCodes.join(", ")}.`
      : "";

    return `Loaded ${units.length} units from ${json.setId}.${duplicateText}${unresolvedText}`;
  }

  async function optimize() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/api/optimize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetTrait: targetTrait || null,
          targetCount: targetTrait ? Number(targetCount) : 0,
          boardSize: Number(boardSize),
          minFrontline: Number(minFrontline),
          carryId,
          lockedUnitIds,
          maxResults: Number(maxResults),
          gameModeId,
          maxUnitCost: Number(maxUnitCost),
          allowEmblems,
          allowMechaTransformer,
          maxEmblems: Number(maxEmblems),
          transformedMechaIds: preTransformedMechaIds,
        }),
      });

      if (!res.ok) {
        throw new Error((await res.json()).error || `API error ${res.status}`);
      }

      const json = await res.json();

      setResults(json.results);
      setSelected(json.results[0] || null);
    } catch (e) {
      setError(e.message || "Failed to optimize");
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          Loading TFT Combo Lab...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1440px] px-3 py-3 md:px-4">
      <header className="tft-glow-panel mb-3 grid gap-3 rounded-2xl border border-amber-200/15 bg-slate-950/75 p-4 shadow-2xl shadow-black/35 backdrop-blur md:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-amber-200/80">
            <Sparkles size={18} />
            Set 17 Combo Optimizer
          </div>

          <h1 className="bg-gradient-to-r from-amber-100 via-cyan-100 to-amber-200 bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-4xl">
            TFT Combo Lab
          </h1>

          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400 md:text-sm">
            בחר Core Units, יעד Trait, כמות Frontline ו־Emblems. המנוע ישלים
            קומפ לפי constraints, MetaTFT unit tiers, breakpoints, carry fit
            ו־Best Items.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200/15 bg-black/25 px-3 py-2 text-xs text-amber-100">
          <div className="font-bold">Meta mode</div>
          <div>Local MetaTFT snapshot</div>
          <div className="mt-1 text-xs text-cyan-200/80">
            Unit builds · star builds · item sets.
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex gap-2 rounded-2xl border border-red-300/30 bg-red-500/15 p-4 text-red-100">
          <AlertTriangle />
          {error}
        </div>
      )}

      <PasteCompBox onImport={importTeamPlannerCode} />

      <section className="tft-glow-panel mb-3 rounded-2xl border border-amber-200/10 bg-slate-950/70 p-3 shadow-xl shadow-black/25">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-cyan-100">
              Builder controls
            </div>
            <div className="text-xs text-slate-400">
              Set the hard requirements first, then optimize.
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full bg-white/10 px-3 py-1">
              Board {boardSize}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">
              Front {minFrontline}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">
              Max cost {maxUnitCost}
            </span>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <Control label="Game Mode">
            <select
              value={gameModeId}
              onChange={(e) => {
                const nextMode =
                  GAME_MODES[e.target.value] || GAME_MODES.capped;

                setGameModeId(nextMode.id);
                setMaxUnitCost(nextMode.maxUnitCost);
                setTargetCount((current) => Math.min(Number(current), 10));
              }}
              className="input"
            >
              <option value="early">Early - max 2-cost</option>
              <option value="mid">Mid - max 3-cost</option>
              <option value="late">Late - max 4-cost</option>
              <option value="capped">Capped - allow 5-cost</option>
            </select>
          </Control>
          <Control label="Max Unit Cost">
            <select
              value={maxUnitCost}
              onChange={(e) => setMaxUnitCost(Number(e.target.value))}
              className="input"
            >
              <option value={1}>Only 1-cost</option>
              <option value={2}>Max 2-cost</option>
              <option value={3}>Max 3-cost</option>
              <option value={4}>Max 4-cost</option>
              <option value={5}>Allow 5-costs</option>
            </select>
          </Control>
          <Control label="Special Sources">
            <label className="mb-2 flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={allowEmblems}
                onChange={(e) => setAllowEmblems(e.target.checked)}
              />
              Emblems
            </label>
            <select
              value={maxEmblems}
              disabled={!allowEmblems}
              onChange={(e) => setMaxEmblems(Number(e.target.value))}
              className="input mt-2 disabled:opacity-40"
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  Max {n} emblem{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={allowMechaTransformer}
                onChange={(e) => setAllowMechaTransformer(e.target.checked)}
              />
              Mecha Transformer
            </label>
          </Control>
          <Control label="Target Trait">
            <select
              value={targetTrait}
              onChange={(e) => {
                const value = e.target.value;
                const nextTrait = data.traits.find((t) => t.name === value);

                setTargetTrait(value);
                setTargetCount(
                  value ? defaultTargetCount(nextTrait, Number(boardSize)) : 0,
                );
              }}
              className="input"
            >
              <option value="">No trait goal / build around units</option>

              {data.traits.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Control>
          <Control label="Target Count">
            {targetTrait ? (
              <select
                value={targetCount}
                onChange={(event) => setTargetCount(Number(event.target.value))}
                className="input"
              >
                {targetCountOptions.map((number) => (
                  <option key={number} value={number}>
                    {number}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl bg-black/20 px-3 py-2 text-sm text-slate-400">
                Disabled in unit-core mode
              </div>
            )}
          </Control>
          <Control label="Board Size">
            <select
              value={boardSize}
              onChange={(e) => {
                const nextSize = Number(e.target.value);

                setBoardSize(nextSize);
                setMinFrontline((current) =>
                  Math.min(Number(current), nextSize),
                );
                setTargetCount((current) =>
                  targetTrait ? Math.min(current, nextSize) : 0,
                );
              }}
              className="input"
            >
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} slots
                </option>
              ))}
            </select>
          </Control>
          <Control label="Frontline">
            <select
              value={minFrontline}
              onChange={(e) => setMinFrontline(Number(e.target.value))}
              className="input"
            >
              {Array.from({ length: Number(boardSize) + 1 }, (_, i) => i).map(
                (n) => (
                  <option key={n} value={n}>
                    {n === 0
                      ? "No minimum"
                      : `${n} front unit${n === 1 ? "" : "s"}`}
                  </option>
                ),
              )}
            </select>
          </Control>
          <Control label="Carry Focus">
            <select
              value={carryId}
              onChange={(e) => setCarryId(e.target.value)}
              className="input"
            >
              <option value="auto">Auto best carry</option>

              {carryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Control>
          <Control label="Results">
            <select
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
              className="input"
            >
              {[6, 12, 20, 30].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Control>
          <button
            type="button"
            onClick={optimize}
            className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-amber-100/50 bg-gradient-to-r from-amber-300 to-cyan-200 px-4 py-2 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:brightness-110 lg:col-span-2 2xl:col-span-1"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={18} />
            Optimize
          </button>
        </div>
      </section>

      <CoreUnitPicker
        champions={data.champions}
        lockedUnitIds={lockedUnitIds}
        setLockedUnitIds={setLockedUnitIds}
        preTransformedMechaIds={preTransformedMechaIds}
        setPreTransformedMechaIds={setPreTransformedMechaIds}
        carryId={carryId}
        setCarryId={setCarryId}
        maxUnitCost={maxUnitCost}
        boardSize={Number(boardSize)}
        minFrontline={Number(minFrontline)}
        targetTrait={targetTrait}
        targetCount={Number(targetCount)}
        allowMechaTransformer={allowMechaTransformer}
      />

      <div className="grid gap-4 2xl:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="space-y-2 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-auto 2xl:pr-1">
          {results.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className={cx(
                "w-full rounded-xl border p-2.5 text-left transition hover:border-amber-200/30 hover:bg-amber-200/5",
                selected?.id === r.id
                  ? "border-cyan-200 bg-cyan-300/15"
                  : "border-white/10 bg-white/6",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-400">
                    #{idx + 1} · {r.label}
                  </div>

                  <div className="text-lg font-black">Score {r.score}</div>
                </div>

                {formatTraitProgress(r.primaryTrait) ? (
                  <div className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">
                    {formatTraitProgress(r.primaryTrait)}
                  </div>
                ) : (
                  <div className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-slate-400">
                    Unit-core
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {r.activeTraits.slice(0, 7).map((t) => (
                  <span
                    key={t.name}
                    className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  >
                    {t.name}{" "}
                    {t.isUnique
                      ? "Unique"
                      : `${t.count}${t.activeAt ? ` · active ${t.activeAt}` : ""}`}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </aside>

        <section className="min-w-0">
          {selected ? (
            <CompDetail
              comp={selected}
              traitsConfig={data.traits}
              traitProfiles={data.traitProfiles || {}}
              itemStats={data.itemStats || {}}
              itemSetStats={data.itemSetStats || {}}
              itemCatalog={data.itemCatalog || {}}
              boardSize={Number(boardSize)}
              minFrontline={Number(minFrontline)}
              targetTrait={targetTrait}
              targetCount={Number(targetCount)}
              allowEmblems={allowEmblems}
              allowMechaTransformer={allowMechaTransformer}
              matchHistory={data.matchHistory || []}
              onLockCompUnits={(units, lockedComp) => {
                setLockedUnitIds(units.map((unit) => unit.id));
                setPreTransformedMechaIds([]);
                setCarryId(
                  lockedComp?.carry?.id || selected?.carry?.id || "auto",
                );
              }}
              onMatchHistorySaved={(nextHistory) => {
                setData((current) => ({
                  ...current,
                  matchHistory: nextHistory,
                }));
              }}
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              No results yet.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
function CoreUnitPicker({
  champions,
  lockedUnitIds,
  setLockedUnitIds,
  preTransformedMechaIds,
  setPreTransformedMechaIds,
  carryId,
  setCarryId,
  maxUnitCost,
  boardSize,
  minFrontline = 0,
  targetTrait,
  targetCount,
  allowMechaTransformer,
}) {
  const [search, setSearch] = useState("");

  const lockedSet = new Set(lockedUnitIds);

  const preTransformedSet = new Set(preTransformedMechaIds);

  const selectedUnits = lockedUnitIds
    .map((id) => champions.find((champ) => champ.id === id))
    .filter(Boolean);

  const selectedMechaUnits = selectedUnits.filter((unit) =>
    unit.traits?.includes("Mecha"),
  );

  const selectedFrontlineCount = countFrontlineUnits(selectedUnits);
  const remainingFrontlineCount = Math.max(
    0,
    Number(minFrontline || 0) - selectedFrontlineCount,
  );

  const effectiveCoreSlots = selectedUnits.reduce((sum, unit) => {
    const isTransformed =
      unit.traits?.includes("Mecha") && preTransformedSet.has(unit.id);

    return sum + (isTransformed ? 2 : 1);
  }, 0);

  const effectiveTargetTraitCount = selectedUnits.reduce((sum, unit) => {
    if (!targetTrait || !unit.traits?.includes(targetTrait)) return sum;

    if (targetTrait === "Mecha" && preTransformedSet.has(unit.id)) {
      return sum + 2;
    }

    return sum + 1;
  }, 0);

  const remainingTraitCount =
    targetTrait && targetCount
      ? Math.max(0, Number(targetCount) - effectiveTargetTraitCount)
      : 0;

  const remainingBoardSlots = Math.max(
    0,
    Number(boardSize || 0) - effectiveCoreSlots,
  );

  function togglePreTransform(unit) {
    if (!unit.traits?.includes("Mecha")) return;

    setPreTransformedMechaIds((prev) => {
      const next = new Set(prev);

      if (next.has(unit.id)) {
        next.delete(unit.id);
        return [...next];
      }

      const nextSlots = selectedUnits.reduce((sum, selectedUnit) => {
        const transformed =
          selectedUnit.id === unit.id || next.has(selectedUnit.id);

        return (
          sum + (selectedUnit.traits?.includes("Mecha") && transformed ? 2 : 1)
        );
      }, 0);

      if (nextSlots > Number(boardSize || 10)) {
        alert(
          `Not enough board slots. This would use ${nextSlots}/${boardSize}.`,
        );
        return prev;
      }

      next.add(unit.id);
      return [...next];
    });
  }
  const filteredChampions = champions
    .filter((champ) => Number(champ.cost) <= Number(maxUnitCost || 5))
    .filter((champ) => {
      const text =
        `${champ.name} ${(champ.traits || []).join(" ")}`.toLowerCase();
      return text.includes(search.toLowerCase());
    })
    .sort((a, b) => {
      return b.cost - a.cost || a.name.localeCompare(b.name);
    });

  function toggleUnit(unitId) {
    setLockedUnitIds((prev) => {
      if (prev.includes(unitId)) {
        setPreTransformedMechaIds((old) => old.filter((id) => id !== unitId));

        return prev.filter((id) => id !== unitId);
      }

      return [...prev, unitId];
    });
  }

  function clearCore() {
    setLockedUnitIds([]);
    setPreTransformedMechaIds([]);
    if (carryId !== "auto") {
      setCarryId("auto");
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-white/10 bg-slate-950/62 p-3 shadow-xl shadow-black/25">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="tft-section-title text-xs">Core Units</div>
          <div className="text-xs text-slate-500">
            Pick units, then optimize.
          </div>
        </div>

        <button
          type="button"
          onClick={clearCore}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
        >
          Clear core
        </button>
      </div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search champion or trait..."
        className="input mb-3 max-w-sm"
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {lockedUnitIds.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-3 py-2 text-sm text-slate-500">
            No core units selected yet.
          </div>
        ) : (
          lockedUnitIds.map((id) => {
            const unit = champions.find((champ) => champ.id === id);
            if (!unit) return null;

            return (
              <div
                key={id}
                className={cx(
                  "flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm",
                  costColor(unit.cost),
                  preTransformedSet.has(unit.id) ? "ring-2 ring-amber-300" : "",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleUnit(id)}
                  className="flex items-center gap-2"
                  title="Remove from core"
                >
                  <ChampionPortrait unit={unit} size="sm" />
                  <span className="font-bold">{unit.name}</span>
                  <span className="text-xs opacity-80">×</span>
                </button>

                {allowMechaTransformer && unit.traits?.includes("Mecha") && (
                  <button
                    type="button"
                    onClick={() => togglePreTransform(unit)}
                    className={cx(
                      "rounded-full px-2 py-1 text-xs font-black",
                      preTransformedSet.has(unit.id)
                        ? "bg-amber-300 text-black"
                        : "bg-black/30 text-amber-100 hover:bg-amber-300/20",
                    )}
                    title={
                      preTransformedSet.has(unit.id)
                        ? "Remove Mecha Transformer"
                        : "Apply Mecha Transformer before Optimize"
                    }
                  >
                    ⚙️{" "}
                    {preTransformedSet.has(unit.id)
                      ? "Transformed"
                      : "Transform"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      {selectedUnits.length > 0 && (
        <div className="mb-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100">
          <div className="mb-2 font-black">Core plan</div>

          <div className="grid gap-2 text-xs md:grid-cols-5">
            <div className="rounded-xl bg-black/20 p-2">
              Core units: <b>{selectedUnits.length}</b>
            </div>

            <div className="rounded-xl bg-black/20 p-2">
              Slots used:{" "}
              <b>
                {effectiveCoreSlots}/{boardSize}
              </b>
            </div>

            <div className="rounded-xl bg-black/20 p-2">
              {targetTrait || "Trait"} count:{" "}
              <b>
                {targetTrait
                  ? `${effectiveTargetTraitCount}/${targetCount || "-"}`
                  : "No target"}
              </b>
            </div>

            <div className="rounded-xl bg-black/20 p-2">
              Frontline:{" "}
              <b>
                {selectedFrontlineCount}/{minFrontline}
              </b>
            </div>

            <div className="rounded-xl bg-black/20 p-2">
              Remaining slots: <b>{remainingBoardSlots}</b>
            </div>
          </div>

          {targetTrait && targetCount > 0 && (
            <div className="mt-2 text-xs text-cyan-100/80">
              Need <b>{remainingTraitCount}</b> more {targetTrait}
              {remainingTraitCount === 0 ? " — target already reached." : "."}
            </div>
          )}

          {Number(minFrontline || 0) > 0 && (
            <div className="mt-1 text-xs text-cyan-100/80">
              Need <b>{remainingFrontlineCount}</b> more frontline unit
              {remainingFrontlineCount === 1 ? "" : "s"}.
            </div>
          )}
        </div>
      )}
      <div className="grid max-h-[280px] gap-1.5 overflow-auto pr-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7">
        {filteredChampions.map((unit) => {
          const selected = lockedSet.has(unit.id);

          return (
            <button
              key={unit.id}
              type="button"
              onClick={() => toggleUnit(unit.id)}
              className={cx(
                "flex items-center gap-2 rounded-xl border p-1.5 text-left transition hover:bg-white/10",
                selected
                  ? "border-cyan-200 bg-cyan-300/15"
                  : "border-white/10 bg-white/5",
              )}
            >
              <ChampionPortrait unit={unit} size="sm" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate font-black">{unit.name}</div>
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 text-[10px] font-black",
                      costBadge(unit.cost),
                    )}
                  >
                    {unit.cost}
                  </span>
                </div>

                <div className="truncate text-xs text-slate-400">
                  {(unit.traits || []).join(" · ")}
                </div>
              </div>

              <div className="text-xs font-black text-cyan-100">
                {selected ? "ON" : "+"}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
function Control({ label, children }) {
  return (
    <label className="block rounded-xl border border-white/10 bg-white/[0.045] p-2 text-xs shadow-inner shadow-white/5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>

      {children}
    </label>
  );
}

function PasteCompBox({ onImport }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handlePasteComp() {
    try {
      const trimmed = code.trim();

      if (!trimmed) {
        throw new Error("Paste a Team Planner code first.");
      }

      setStatus("loading");
      setMessage("");

      const resultMessage = await onImport(trimmed);

      setStatus("success");
      setMessage(resultMessage || "Comp loaded.");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Could not load comp.");
    }
  }

  return (
    <div className="mb-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-cyan-100">Paste Comp</div>
          <div className="text-xs text-cyan-100/70">
            Paste a TFT Team Planner code to load that board into the app.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handlePasteComp();
            }
          }}
          placeholder="0201d01b00d03601e05801f000000000TFTSet17"
          className="input flex-1"
        />

        <button
          type="button"
          onClick={handlePasteComp}
          disabled={status === "loading"}
          className="rounded-xl border border-amber-100/40 bg-gradient-to-r from-amber-300 to-cyan-200 px-4 py-2 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "Loading..." : "Load Comp"}
        </button>
      </div>

      {message && (
        <div
          className={cx(
            "mt-2 rounded-xl px-3 py-2 text-xs",
            status === "error"
              ? "bg-red-500/15 text-red-100"
              : "bg-emerald-400/10 text-emerald-100",
          )}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function CopyCompButton({ units }) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handleCopyComp() {
    try {
      setStatus("copying");
      setMessage("");

      const response = await fetch(`${API}/api/team-planner-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          units: (units || []).map((unit) => ({
            id: unit.id,
            name: unit.name,
            apiName: unit.apiName,
            characterName: unit.characterName,
            character_id: unit.character_id,
            characterId: unit.characterId,
          })),
        }),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(json.error || `API error ${response.status}`);
      }

      await copyTextToClipboard(json.code);

      setStatus("copied");
      setMessage(`Copied ${json.setId || "TFT"} code`);

      setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 2200);
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Failed to copy comp");
    }
  }

  const disabled = status === "copying" || !units?.length;

  return (
    <div
      className={cx(
        "rounded-xl border px-3 py-2",
        status === "error"
          ? "border-red-300/40 bg-red-500/15 text-red-100"
          : status === "copied"
            ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100"
            : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
      )}
    >
      <div className="text-xs">Team Planner</div>

      <button
        type="button"
        onClick={handleCopyComp}
        disabled={disabled}
        className="mt-1 font-black transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        title="Copy this visible board as a TFT Team Planner code"
      >
        {status === "copying"
          ? "Copying..."
          : status === "copied"
            ? "Copied!"
            : "Copy Comp"}
      </button>

      {message && (
        <div className="mt-1 max-w-44 text-[10px] leading-3 opacity-85">
          {message}
        </div>
      )}
    </div>
  );
}

function getCompUnitKey(units = []) {
  return units
    .map((unit) => unit.id || unit.name)
    .filter(Boolean)
    .sort()
    .join("|");
}

function getMatchHistoryForComp(comp, matchHistory = []) {
  const compKey = getCompUnitKey(comp.units || []);

  return (matchHistory || []).filter((entry) => {
    if (entry.compId && entry.compId === comp.id) return true;

    const entryKey = getCompUnitKey(entry.units || []);
    return entryKey && entryKey === compKey;
  });
}

function PersonalCompStats({ comp, matchHistory = [] }) {
  const entries = getMatchHistoryForComp(comp, matchHistory);

  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/6 p-3 text-sm text-slate-300">
        <div className="mb-1 font-black text-cyan-100">Personal stats</div>
        No saved games for this exact comp yet.
      </div>
    );
  }

  const avgPlacement =
    entries.reduce((sum, entry) => sum + Number(entry.placement || 8), 0) /
    entries.length;
  const top4Rate =
    (entries.filter((entry) => Number(entry.placement || 8) <= 4).length /
      entries.length) *
    100;
  const winRate =
    (entries.filter((entry) => Number(entry.placement || 8) === 1).length /
      entries.length) *
    100;

  return (
    <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3 text-sm text-cyan-100">
      <div className="mb-3 font-black">Personal stats</div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-2xl bg-black/20 p-2">
          <div className="text-slate-400">Games</div>
          <div className="text-lg font-black">{entries.length}</div>
        </div>
        <div className="rounded-2xl bg-black/20 p-2">
          <div className="text-slate-400">Avg</div>
          <div className="text-lg font-black">{avgPlacement.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl bg-black/20 p-2">
          <div className="text-slate-400">Top 4</div>
          <div className="text-lg font-black">{top4Rate.toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-cyan-100/80">
        Win rate: <b>{winRate.toFixed(0)}%</b>
      </div>
    </div>
  );
}

function LogResultBox({ comp, units = [], activeTraits = [], onSaved }) {
  const [placement, setPlacement] = useState(4);
  const [rating, setRating] = useState("okay");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function saveResult() {
    try {
      setStatus("saving");
      setMessage("");

      const response = await fetch(`${API}/api/match-history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          compId: comp.id,
          placement,
          rating,
          carryId: comp.carry?.id || null,
          carryName: comp.carry?.name || null,
          units: (units || []).map((unit) => ({
            id: unit.id,
            name: unit.name,
            cost: unit.cost,
            traits: unit.traits || [],
          })),
          traits: (activeTraits || []).map((trait) => ({
            name: trait.name,
            count: trait.count,
            activeAt: trait.activeAt,
          })),
          notes,
        }),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(json.error || `API error ${response.status}`);
      }

      setStatus("saved");
      setMessage("Result saved.");
      setNotes("");
      onSaved?.(json.matchHistory || []);
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Failed to save result.");
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/5 p-3">
      <div className="mb-3 font-black text-emerald-100">Log Result</div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs text-slate-300">
          Placement
          <select
            value={placement}
            onChange={(event) => setPlacement(Number(event.target.value))}
            className="input mt-1"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                #{n}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          How it felt
          <select
            value={rating}
            onChange={(event) => setRating(event.target.value)}
            className="input mt-1"
          >
            <option value="good">👍 Good</option>
            <option value="okay">😐 Okay</option>
            <option value="bad">👎 Bad</option>
          </select>
        </label>

        <button
          type="button"
          onClick={saveResult}
          disabled={status === "saving"}
          className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:opacity-60"
        >
          {status === "saving" ? "Saving..." : "Save Result"}
        </button>
      </div>

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes: items hit, weak frontline, contested, lost to AP, etc..."
        className="input mt-3 min-h-20"
      />

      {message && (
        <div
          className={cx(
            "mt-2 rounded-xl px-3 py-2 text-xs",
            status === "error"
              ? "bg-red-500/15 text-red-100"
              : "bg-emerald-400/10 text-emerald-100",
          )}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function CompDetail({
  comp,
  traitsConfig,
  traitProfiles = {},
  itemStats = {},
  itemSetStats = {},
  itemCatalog = {},
  boardSize = 10,
  minFrontline = 0,
  targetTrait,
  targetCount,
  allowEmblems = true,
  allowMechaTransformer = true,
  matchHistory = [],
  onMatchHistorySaved,
  onLockCompUnits,
}) {
  const [boardUnits, setBoardUnits] = useState(comp.units);
  const [upgradedMechaIds, setUpgradedMechaIds] = useState(new Set());
  const [armedTool, setArmedTool] = useState(null);
  const [unitEmblems, setUnitEmblems] = useState({});
  const starPlans = comp.starPlans || {};

  useEffect(() => {
    setBoardUnits(comp.units);
    setUpgradedMechaIds(new Set());
    setArmedTool(null);
    setUnitEmblems({});
  }, [comp.id]);

  const boardSlotLimit = Number(boardSize || 10);

  const effectiveBoardUnits = boardUnits.map((unit) => {
    const addedTraits = unitEmblems[unit.id] || [];

    return {
      ...unit,
      baseTraits: unit.traits || [],
      emblems: addedTraits,
      traits: [...new Set([...(unit.traits || []), ...addedTraits])],
    };
  });

  const upgradedMechaUnits = effectiveBoardUnits.filter((unit) =>
    upgradedMechaIds.has(unit.id),
  );

  const naturalMechaUnits = effectiveBoardUnits.filter((unit) =>
    isMechaUnit(unit),
  );
  const naturalMechaCount = naturalMechaUnits.length;
  const upgradedMechaCount = upgradedMechaUnits.length;

  const effectiveMechaCount = effectiveBoardUnits.reduce((sum, unit) => {
    return sum + getTraitContribution(unit, "Mecha", upgradedMechaIds);
  }, 0);

  const boardSlotsUsed = getBoardSlotsUsed(
    effectiveBoardUnits,
    upgradedMechaIds,
  );
  const boardOverflow = boardSlotsUsed > boardSlotLimit;
  const frontlineCount = countFrontlineUnits(effectiveBoardUnits);
  const frontlineMissing = Math.max(
    0,
    Number(minFrontline || 0) - frontlineCount,
  );

  const manualTraitRows = getTraitRowsFromBoard(
    effectiveBoardUnits,
    upgradedMechaIds,
    traitsConfig || [],
  );

  const targetTraitCount = Number(
    targetCount || comp.primaryTrait?.targetCount || 0,
  );

  const currentTargetTraitCount =
    targetTrait === "Mecha"
      ? effectiveMechaCount
      : manualTraitRows.find((trait) => trait.name === targetTrait)?.count || 0;

  const targetReached =
    targetTrait &&
    targetTraitCount > 0 &&
    currentTargetTraitCount >= targetTraitCount;

  const targetOvercapped =
    targetTrait &&
    targetTraitCount > 0 &&
    currentTargetTraitCount > targetTraitCount;

  function toggleMechaTransformer(unit) {
    if (!isMechaUnit(unit)) return;

    setUpgradedMechaIds((prev) => {
      const next = new Set(prev);

      // Clicking/dropping again removes the transform.
      if (next.has(unit.id)) {
        next.delete(unit.id);
        return next;
      }

      const nextUpgradedIds = new Set(next);
      nextUpgradedIds.add(unit.id);

      const nextBoardSlotsUsed = getBoardSlotsUsed(
        effectiveBoardUnits,
        nextUpgradedIds,
      );

      if (nextBoardSlotsUsed > boardSlotLimit) {
        alert(
          `Board is full. This would use ${nextBoardSlotsUsed}/${boardSlotLimit} slots.`,
        );
        return next;
      }

      next.add(unit.id);
      return next;
    });

    setArmedTool(null);
  }

  function removeBoardUnit(unitId) {
    setBoardUnits((prev) => prev.filter((unit) => unit.id !== unitId));

    setUpgradedMechaIds((prev) => {
      const next = new Set(prev);
      next.delete(unitId);
      return next;
    });

    setUnitEmblems((prev) => {
      const next = { ...prev };
      delete next[unitId];
      return next;
    });
  }

  function toggleEmblemOnUnit(unitId, traitName) {
    setUnitEmblems((prev) => {
      const unit = boardUnits.find((candidate) => candidate.id === unitId);

      if (!unit || unit.traits?.includes(traitName)) {
        return prev;
      }

      const current = prev[unitId] || [];

      if (current.includes(traitName)) {
        const nextTraits = current.filter((name) => name !== traitName);
        const next = { ...prev };

        if (nextTraits.length) {
          next[unitId] = nextTraits;
        } else {
          delete next[unitId];
        }

        return next;
      }

      return {
        ...prev,
        [unitId]: [...current, traitName],
      };
    });
  }

  return (
    <div className="space-y-5">
      <div className="tft-glow-panel rounded-2xl border border-amber-200/10 bg-slate-950/72 p-3 shadow-2xl shadow-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="tft-section-title text-[11px]">
              Recommended Composition
            </div>

            <h2 className="text-xl font-black text-slate-50 md:text-2xl">
              {targetTrait && targetTraitCount
                ? `${targetTrait} ${currentTargetTraitCount}/${targetTraitCount} · ${
                    manualTraitRows.filter(
                      (trait) => trait.isActive && !trait.isUnique,
                    ).length
                  } active traits`
                : comp.label}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-amber-100">
              <div className="text-xs">Carry</div>
              <div className="font-black">{comp.carry?.name || "Auto"}</div>
            </div>
            <div
              className={cx(
                "rounded-xl border px-3 py-2",
                frontlineMissing
                  ? "border-red-300/40 bg-red-500/15 text-red-100"
                  : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
              )}
            >
              <div className="text-xs">Frontline</div>
              <div className="font-black">
                {frontlineCount}/{minFrontline}
              </div>
            </div>
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-cyan-100">
              <div className="text-xs">Board</div>
              <div className="font-black">
                {boardSlotsUsed}/{boardSlotLimit}
              </div>
            </div>
            <CopyCompButton units={effectiveBoardUnits} />
            <button
              type="button"
              onClick={() => onLockCompUnits?.(effectiveBoardUnits, comp)}
              className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-left text-amber-100 transition hover:bg-amber-300/20"
              title="Use this visible board as locked core units for the next optimization"
            >
              <div className="text-xs">Planning</div>
              <div className="font-black">Lock Board</div>
            </button>
          </div>
        </div>

        <TraitBar
          traits={manualTraitRows}
          traitProfiles={traitProfiles}
          traitsConfig={traitsConfig}
        />

        {allowEmblems && <EmblemTray traitsConfig={traitsConfig || []} />}

        {allowMechaTransformer && naturalMechaCount > 0 && (
          <MechaTransformerTool
            armed={armedTool === MECHA_TRANSFORMER_TOOL}
            onArm={() => {
              setArmedTool((current) =>
                current === MECHA_TRANSFORMER_TOOL
                  ? null
                  : MECHA_TRANSFORMER_TOOL,
              );
            }}
            naturalMechaCount={naturalMechaCount}
            upgradedMechaCount={upgradedMechaCount}
            effectiveMechaCount={effectiveMechaCount}
            boardSlotsUsed={boardSlotsUsed}
            boardSlotLimit={boardSlotLimit}
            boardOverflow={boardOverflow}
            targetTrait={targetTrait}
            targetCount={targetTraitCount}
            targetReached={targetReached}
            targetOvercapped={targetOvercapped}
          />
        )}

        {comp.emblemPlan && <EmblemNotice plan={comp.emblemPlan} />}

        {frontlineMissing > 0 && (
          <div className="mb-4 rounded-2xl border border-red-300/40 bg-red-500/15 p-3 text-sm text-red-100">
            Frontline requirement not met: {frontlineCount}/{minFrontline}. Add
            more tanks/front units.
          </div>
        )}

        {boardOverflow && (
          <div className="mb-4 rounded-2xl border border-red-300/40 bg-red-500/15 p-3 text-sm text-red-100">
            Illegal board: {boardSlotsUsed}/{boardSlotLimit} slots used. Remove
            a unit or remove a Mecha Transformer.
          </div>
        )}

        {targetOvercapped && (
          <div className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-500/15 p-3 text-sm text-amber-100">
            You are above the selected target: {targetTrait}{" "}
            {currentTargetTraitCount}/{targetTraitCount}. This can be valid for
            testing, but the optimizer target was lower.
          </div>
        )}

        <div className="relative z-[200] overflow-visible">
          <TftBoard
            units={effectiveBoardUnits}
            carryId={comp.carry?.id}
            upgradedMechaIds={upgradedMechaIds}
            upgradedMechaUnits={upgradedMechaUnits}
            armedTool={armedTool}
            onToggleMechaTransformer={toggleMechaTransformer}
            onRemoveUnit={removeBoardUnit}
            onAddEmblem={toggleEmblemOnUnit}
            boardSlotLimit={boardSlotLimit}
            starPlans={starPlans}
          />
        </div>

        <div className="relative z-0 mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <LogResultBox
            comp={comp}
            units={effectiveBoardUnits}
            activeTraits={manualTraitRows}
            onSaved={onMatchHistorySaved}
          />
          <PersonalCompStats comp={comp} matchHistory={matchHistory} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {effectiveBoardUnits.map((unit) => (
          <ChampionCard
            key={unit.id}
            unit={unit}
            isCarry={comp.carry?.id === unit.id}
            isMechaUpgraded={upgradedMechaIds.has(unit.id)}
            bestItems={getBestItemsForUnit(unit, itemStats, itemSetStats)}
            itemSets={getBestItemSetsForUnit(unit, itemSetStats, itemStats)}
            itemCatalog={itemCatalog}
            starPlan={getUnitStarPlan(unit, starPlans)}
          />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard
          icon={<Star />}
          title="Why this ranked high"
          items={[
            ...comp.reasons,
            upgradedMechaCount > 0
              ? `Transformed Mecha units: ${upgradedMechaUnits
                  .map((unit) => unit.name)
                  .join(", ")}.`
              : null,
            upgradedMechaCount > 0
              ? `Each transformed Mecha counts as 2 Mecha and uses 2 board slots.`
              : null,
            `Current ${targetTrait || comp.primaryTrait?.name}: ${currentTargetTraitCount}${
              targetTraitCount ? `/${targetTraitCount}` : ""
            }.`,
            `Board slots used: ${boardSlotsUsed}/${boardSlotLimit}.`,
            Number(minFrontline || 0) > 0
              ? `Frontline units: ${frontlineCount}/${minFrontline}.`
              : null,
          ].filter(Boolean)}
        />

        <ItemSetInfoCard
          icon={<Sword />}
          title="Carry item sets"
          itemCatalog={itemCatalog}
          itemSets={
            comp.carry
              ? getBestItemSetsForUnit(comp.carry, itemSetStats, itemStats)
              : []
          }
        />

        <InfoCard
          icon={<Shield />}
          title="Risks / notes"
          items={[
            ...comp.warnings,
            boardOverflow
              ? `Board exceeds ${boardSlotLimit} slots. This is not playable.`
              : null,
            targetOvercapped
              ? `You are above the selected ${targetTrait} target.`
              : null,
            frontlineMissing > 0
              ? `Frontline requirement is short by ${frontlineMissing}.`
              : null,
            upgradedMechaCount > 0
              ? `A transformed Mecha is not a separate champion; it is the same unit occupying 2 slots and counting as 2 Mecha.`
              : null,
          ].filter(Boolean)}
        />
      </div>
    </div>
  );
}

function TraitBar({ traits, traitProfiles = {}, traitsConfig = [] }) {
  return (
    <div className="my-3 flex flex-wrap gap-1.5">
      {traits.map((trait) => {
        const profile = traitProfiles[trait.name] || {};
        const config = traitsConfig.find((t) => t.name === trait.name) || {};
        const breakpoints = config.breakpoints || [];
        const tags = profile.tags || [];

        return (
          <span
            key={trait.name}
            className={cx(
              "group relative rounded-lg border px-2.5 py-1.5 text-xs",
              trait.isActive
                ? "border-cyan-200/60 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-white/5 text-slate-400",
            )}
          >
            {trait.name}{" "}
            {trait.isUnique ? (
              <b>Unique</b>
            ) : (
              <>
                <b>{trait.count}</b>
                {trait.activeAt ? (
                  <span className="ml-1 text-xs text-slate-300">
                    · active {trait.activeAt}
                  </span>
                ) : null}
                {trait.nextBreakpoint ? (
                  <span className="ml-1 text-xs text-amber-200">
                    · next {trait.nextBreakpoint}
                  </span>
                ) : null}
              </>
            )}
            {trait.virtualCount ? (
              <span className="ml-1 text-amber-200">
                (+{trait.virtualCount})
              </span>
            ) : null}
            <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-2xl border border-white/15 bg-slate-950/95 p-3 text-left text-xs text-slate-200 shadow-2xl backdrop-blur group-hover:block">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-base font-black text-white">
                  {trait.name}
                </div>

                {profile.tier && (
                  <div className="rounded-full bg-cyan-300 px-2 py-0.5 text-[11px] font-black text-slate-950">
                    Tier {profile.tier}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div>
                  <span className="text-slate-400">Type:</span>{" "}
                  <b>{config.type || trait.type || "Trait"}</b>
                </div>

                <div>
                  <span className="text-slate-400">Current:</span>{" "}
                  <b>
                    {trait.isUnique
                      ? trait.isActive
                        ? "Unique active"
                        : "Unique inactive"
                      : `${trait.count}${trait.activeAt ? ` · active ${trait.activeAt}` : ""}`}
                  </b>
                </div>

                {!trait.isUnique && breakpoints.length > 0 && (
                  <div>
                    <span className="text-slate-400">Breakpoints:</span>{" "}
                    <b>{breakpoints.join(" / ")}</b>
                  </div>
                )}

                {trait.nextBreakpoint && (
                  <div>
                    <span className="text-slate-400">Next:</span>{" "}
                    <b>{trait.nextBreakpoint}</b>
                  </div>
                )}

                {profile.score && (
                  <div>
                    <span className="text-slate-400">Profile score:</span>{" "}
                    <b>{profile.score}</b>
                  </div>
                )}
              </div>

              {tags.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-slate-400">Helps with:</div>

                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-cyan-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profile.notes && (
                <div className="mt-3 rounded-xl bg-white/5 p-2 leading-5 text-slate-300">
                  {profile.notes}
                </div>
              )}
            </div>
          </span>
        );
      })}
    </div>
  );
}

function MechaTransformerTool({
  armed,
  onArm,
  naturalMechaCount,
  upgradedMechaCount,
  effectiveMechaCount,
  boardSlotsUsed,
  boardSlotLimit,
  boardOverflow,
  targetTrait,
  targetCount,
  targetReached,
  targetOvercapped,
}) {
  return (
    <div className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-amber-100">
            Mecha Transformer
          </div>

          <div className="text-xs text-amber-100/75">
            Drag the Transformer onto a Mecha unit. Drop/click again on the same
            unit to remove it.
          </div>
        </div>

        <button
          type="button"
          draggable
          onClick={onArm}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", MECHA_TRANSFORMER_TOOL);
            event.dataTransfer.effectAllowed = "move";
          }}
          className={cx(
            "rounded-2xl border px-4 py-3 text-left shadow-xl transition",
            armed
              ? "border-amber-100 bg-amber-300 text-amber-950"
              : "border-amber-300/40 bg-black/20 text-amber-100 hover:bg-amber-300/20",
          )}
          title="Drag this onto a Mecha unit"
        >
          <div className="text-lg font-black">⚙️ Transformer</div>
          <div className="text-xs">Mecha unit becomes 2 slots · 2 Mecha</div>
        </button>
      </div>

      <div className="grid gap-2 text-xs text-amber-100/85 md:grid-cols-4">
        <div className="rounded-xl bg-black/20 p-2">
          Natural Mecha: <b>{naturalMechaCount}</b>
        </div>

        <div className="rounded-xl bg-black/20 p-2">
          Transformed: <b>{upgradedMechaCount}</b>
        </div>

        <div className="rounded-xl bg-black/20 p-2">
          Effective Mecha: <b>{effectiveMechaCount}</b>
        </div>

        <div
          className={cx(
            "rounded-xl p-2",
            boardOverflow ? "bg-red-500/30 text-red-100" : "bg-black/20",
          )}
        >
          Slots Used:{" "}
          <b>
            {boardSlotsUsed}/{boardSlotLimit}
          </b>
        </div>
      </div>

      {targetTrait === "Mecha" && targetCount > 0 && (
        <div
          className={cx(
            "mt-3 rounded-xl px-3 py-2 text-xs font-bold",
            targetOvercapped
              ? "bg-red-500/25 text-red-100"
              : targetReached
                ? "bg-emerald-500/20 text-emerald-100"
                : "bg-black/20 text-amber-100",
          )}
        >
          Target: Mecha {targetCount} · Current: {effectiveMechaCount}
          {targetOvercapped
            ? " · Over target"
            : targetReached
              ? " · Target reached"
              : ` · Need ${targetCount - effectiveMechaCount} more`}
        </div>
      )}
    </div>
  );
}

function EmblemNotice({ plan }) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">
      <div className="font-black">Emblem / special source needed</div>

      <div>
        {plan.trait} needs +{plan.count} extra count. The optimizer assumes you
        can place {plan.count === 1 ? "an emblem" : "emblems"} on a non-
        {plan.trait} unit.
      </div>
    </div>
  );
}

function getUnitStarPlan(unit, starPlans = {}) {
  const direct = starPlans?.[unit.id] || starPlans?.[unit.apiName];

  if (direct) {
    return {
      starLevel: Math.max(1, Math.min(Number(direct.starLevel || 1), 3)),
      label: direct.label || "Expected star level",
      score: Number(direct.score || 0),
      source: direct.source || null,
    };
  }

  const cost = Number(unit?.cost || 1);

  if (cost <= 2) {
    return {
      starLevel: 2,
      label: "2★ expected",
      score: 0,
      source: "fallback",
    };
  }

  if (cost <= 4) {
    return {
      starLevel: 2,
      label: "2★ late-game goal",
      score: 0,
      source: "fallback",
    };
  }

  return {
    starLevel: 1,
    label: "1★ expected / 2★ luxury",
    score: 0,
    source: "fallback",
  };
}

function StarBadge({ starLevel = 1, compact = false }) {
  const level = Math.max(1, Math.min(Number(starLevel || 1), 3));

  const colors = {
    1: "text-orange-300 drop-shadow-[0_1px_4px_rgba(251,146,60,0.75)]",
    2: "text-slate-200 drop-shadow-[0_1px_4px_rgba(226,232,240,0.85)]",
    3: "text-yellow-300 drop-shadow-[0_1px_5px_rgba(253,224,71,0.95)]",
  };

  return (
    <div
      className={cx(
        "select-none font-black leading-none tracking-tight",
        compact ? "text-[12px]" : "text-sm",
        colors[level],
      )}
      aria-label={`${level} star`}
      title={`${level} star`}
    >
      {"★".repeat(level)}
    </div>
  );
}

function formatMetaNumber(value, suffix = "") {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value}${suffix}`;
  return `${number.toFixed(number % 1 === 0 ? 0 : 2)}${suffix}`;
}

function UnitHoverCard({ unit, starPlan = null }) {
  const traits = unit?.traits || [];
  const emblems = unit?.emblems || [];
  const metaBuild = starPlan?.build || starPlan?.bestBuild || null;

  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-[10001] mb-1 hidden w-72 -translate-x-1/2 translate-y-3 rounded-2xl border border-cyan-300/40 bg-slate-950 px-4 py-3 text-left text-sm text-slate-100 opacity-100 shadow-2xl ring-1 ring-black/80 group-hover:block">
      {" "}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-white">{unit.name}</div>
          <div className="mt-1 text-sm font-semibold text-slate-300">
            Cost {unit.cost} · Tier {unit.tier || "?"}
          </div>

          {starPlan && (
            <div className="mt-2 flex items-center gap-2">
              <StarBadge starLevel={starPlan.starLevel} />
              <span className="text-xs font-bold text-slate-300">
                {starPlan.label}
              </span>
            </div>
          )}

          {metaBuild && (
            <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-slate-300">
              <div className="rounded-lg bg-amber-300/10 px-2 py-1 text-amber-100">
                Avg <b>{formatMetaNumber(metaBuild.avgPlace) || "-"}</b>
              </div>
              <div className="rounded-lg bg-cyan-300/10 px-2 py-1 text-cyan-100">
                WR <b>{formatMetaNumber(metaBuild.winRate, "%") || "-"}</b>
              </div>
              <div className="rounded-lg bg-white/5 px-2 py-1">
                Games <b>{formatMetaNumber(metaBuild.games) || "-"}</b>
              </div>
            </div>
          )}
        </div>

        <span
          className={cx(
            "rounded-full px-2 py-0.5 text-xs font-black",
            costBadge(unit.cost),
          )}
        >
          {unit.cost}
        </span>
      </div>
      <div className="mt-3">
        <div className="text-xs font-bold uppercase tracking-wide text-cyan-200">
          Role / Class
        </div>
        <div className="mt-1 text-base font-bold text-white">
          {unit.role || "Unknown"}
        </div>
      </div>
      <div className="mt-3">
        <div className="text-xs font-bold uppercase tracking-wide text-cyan-200">
          Traits
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {traits.length ? (
            traits.map((trait) => (
              <span
                key={trait}
                className={cx(
                  "rounded-full px-2 py-1 text-xs font-black",
                  emblems.includes(trait)
                    ? "bg-amber-300 text-black"
                    : "bg-cyan-300/10 text-cyan-100",
                )}
              >
                {trait}
                {emblems.includes(trait) ? " Emblem" : ""}
              </span>
            ))
          ) : (
            <span className="text-slate-400">No traits</span>
          )}
        </div>
      </div>
      {unit.stats && (
        <div className="mt-3 grid grid-cols-3 gap-1 text-xs text-slate-300">
          <div className="rounded-lg bg-white/5 px-2 py-1">
            HP <b>{unit.stats.hp ?? "?"}</b>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-1">
            AR <b>{unit.stats.armor ?? "?"}</b>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-1">
            MR <b>{unit.stats.magicResist ?? "?"}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function TftBoard({
  units,
  carryId,
  upgradedMechaIds = new Set(),
  upgradedMechaUnits = [],
  armedTool,
  onToggleMechaTransformer,
  onRemoveUnit,
  onAddEmblem,
  boardSlotLimit = 10,
  starPlans = {},
}) {
  const transformerSlots = upgradedMechaUnits.map((unit) => ({
    kind: "transformer-slot",
    unit,
  }));

  const regularSlots = units.map((unit) => ({
    kind: "unit",
    unit,
  }));

  const usedSlots = [...regularSlots, ...transformerSlots];

  const slots = Array.from(
    { length: boardSlotLimit },
    (_, i) => usedSlots[i] || null,
  );

  function canReceiveTransformer(unit) {
    return isMechaUnit(unit);
  }

  return (
    <div className="relative z-[200] mx-auto grid max-w-3xl grid-cols-5 gap-1.5 overflow-visible rounded-2xl border border-amber-200/10 bg-gradient-to-b from-slate-900/85 to-black/45 p-2 shadow-inner shadow-black/50">
      {" "}
      {slots.map((slot, i) => {
        if (!slot) {
          return (
            <div
              key={i}
              className="relative flex aspect-square items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/5 text-center text-[10px]"
            >
              <span className="text-slate-600">empty</span>
            </div>
          );
        }

        if (slot.kind === "transformer-slot") {
          return (
            <button
              key={`transformer-${slot.unit.id}`}
              type="button"
              onClick={() => onToggleMechaTransformer?.(slot.unit)}
              className="relative flex aspect-square items-center justify-center rounded-2xl border border-amber-300/50 bg-amber-300/10 text-center transition hover:bg-amber-300/20"
              title={`${slot.unit.name} is transformed: this is the unit's second board slot. Click to remove Transformer.`}
            >
              <div>
                <div className="text-3xl">⚙️</div>
                <div className="mt-1 px-1 text-[10px] font-black text-amber-100">
                  {slot.unit.name}
                </div>
                <div className="text-[10px] text-amber-200/80">2nd slot</div>
              </div>
            </button>
          );
        }

        const unit = slot.unit;
        const starPlan = getUnitStarPlan(unit, starPlans);
        const isMecha = canReceiveTransformer(unit);
        const isUpgraded = upgradedMechaIds.has(unit.id);
        const isArmedTarget = armedTool === MECHA_TRANSFORMER_TOOL && isMecha;

        return (
          <button
            type="button"
            key={unit.id}
            onClick={() => {
              if (isArmedTarget) {
                onToggleMechaTransformer(unit);
                return;
              }

              onRemoveUnit?.(unit.id);
            }}
            onDragOver={(event) => {
              const hasPlainText =
                event.dataTransfer.types.includes("text/plain");

              if (isMecha || hasPlainText) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();

              const tool = event.dataTransfer.getData("text/plain");

              if (tool === MECHA_TRANSFORMER_TOOL && isMecha) {
                onToggleMechaTransformer(unit);
                return;
              }

              if (tool.startsWith("EMBLEM:")) {
                onAddEmblem?.(unit.id, tool.replace("EMBLEM:", ""));
              }
            }}
            className={cx(
              "group relative z-10 flex aspect-square items-center justify-center rounded-2xl border text-center text-xs transition hover:z-[1000]",
              costColor(unit.cost),
              "cursor-pointer hover:scale-[1.02]",
              isArmedTarget
                ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-slate-950"
                : "",
              isUpgraded
                ? "border-amber-200 bg-amber-300/20 shadow-amber-500/30"
                : "",
            )}
            aria-label={
              isArmedTarget
                ? isUpgraded
                  ? `${unit.name} is transformed. Click/drop again to remove Transformer.`
                  : `Click/drop to transform ${unit.name}.`
                : `Click to remove ${unit.name}`
            }
          >
            <ChampionPortrait unit={unit} size="board" />

            <div
              className={cx(
                "absolute left-1 top-1 rounded-full px-1.5 text-[10px] font-black",
                costBadge(unit.cost),
              )}
            >
              {unit.cost}
            </div>

            <div className="absolute bottom-1 left-1 right-1 rounded bg-black/70 px-1 py-0.5 text-center">
              <div className="truncate text-[10px] font-bold text-white">
                {unit.name}
              </div>
              <StarBadge starLevel={starPlan.starLevel} compact />
            </div>

            {carryId === unit.id && (
              <div className="absolute -right-1 -top-1 rounded-full bg-amber-300 px-1.5 text-[10px] font-black text-black">
                C
              </div>
            )}

            {isMecha && !isUpgraded && (
              <div className="absolute right-1 top-1 rounded-full border border-amber-200/50 bg-black/70 px-1.5 text-[10px] font-black text-amber-100">
                Mecha
              </div>
            )}

            {isUpgraded && (
              <div className="absolute right-1 top-1 rounded-full border border-amber-100 bg-amber-300 px-1.5 text-[10px] font-black text-black">
                Transformed
              </div>
            )}

            {unit.emblems?.length > 0 && (
              <div className="absolute left-1 right-1 top-6 flex flex-wrap justify-center gap-1">
                {unit.emblems.map((traitName) => (
                  <span
                    key={traitName}
                    className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-black text-black"
                  >
                    {traitName}
                  </span>
                ))}
              </div>
            )}

            {isArmedTarget && !isUpgraded && (
              <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-xl bg-amber-300 px-1 py-1 text-[10px] font-black text-black shadow-lg">
                Drop ⚙️
              </div>
            )}

            {isArmedTarget && isUpgraded && (
              <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-xl bg-red-300 px-1 py-1 text-[10px] font-black text-black shadow-lg">
                Drop to remove
              </div>
            )}

            <UnitHoverCard unit={unit} starPlan={starPlan} />
          </button>
        );
      })}
    </div>
  );
}

function ChampionCard({
  unit,
  isCarry,
  isMechaUpgraded = false,
  bestItems = [],
  itemSets = [],
  itemCatalog = {},
  starPlan = null,
}) {
  return (
    <article
      className={cx(
        "rounded-xl border p-2.5 shadow-lg backdrop-blur",
        costColor(unit.cost),
      )}
    >
      <div className="flex items-start gap-3">
        <ChampionPortrait unit={unit} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-black">{unit.name}</h3>

            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-xs font-black",
                costBadge(unit.cost),
              )}
            >
              {unit.cost}★
            </span>

            {isCarry && (
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-black text-black">
                Carry
              </span>
            )}
            {isMechaUpgraded && (
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-black text-black">
                Transformed
              </span>
            )}

            {isFrontlineUnit(unit) && (
              <span className="rounded-full bg-emerald-300 px-2 py-0.5 text-xs font-black text-emerald-950">
                Front
              </span>
            )}
          </div>

          <div className="text-xs text-slate-300">
            Cost {unit.cost} · Tier {unit.tier} · {unit.role}
          </div>

          {starPlan && (
            <>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-300">
                <StarBadge starLevel={starPlan.starLevel} />
                <span>{starPlan.label}</span>
              </div>

              {(starPlan.build || starPlan.bestBuild) && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-300">
                  {(starPlan.build || starPlan.bestBuild).avgPlace != null && (
                    <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-amber-100">
                      Avg {(starPlan.build || starPlan.bestBuild).avgPlace}
                    </span>
                  )}
                  {(starPlan.build || starPlan.bestBuild).winRate != null && (
                    <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-cyan-100">
                      WR {(starPlan.build || starPlan.bestBuild).winRate}%
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {unit.traits.map((t) => (
          <span
            key={t}
            className={cx(
              "rounded-full px-2 py-1 text-xs",
              unit.emblems?.includes(t)
                ? "bg-amber-300 text-black font-black"
                : "bg-black/20",
            )}
          >
            {t}
            {unit.emblems?.includes(t) ? " Emblem" : ""}
          </span>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-bold text-slate-400">
          Best item sets
        </div>
        <ItemSetList
          itemSets={
            itemSets?.length
              ? itemSets
              : [{ id: `flat-${unit.id}`, items: bestItems }]
          }
          itemCatalog={itemCatalog}
          compact
        />
      </div>
    </article>
  );
}

function InfoCard({ icon, title, items }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
      <div className="mb-3 flex items-center gap-2 font-black text-cyan-100">
        {icon}
        {title}
      </div>

      <ul className="space-y-1.5 text-xs leading-5 text-slate-300">
        {(items?.length ? items : ["No notes."]).map((x, i) => (
          <li key={i}>• {x}</li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

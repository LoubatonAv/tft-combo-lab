import {
  canonicalizeIdentifier,
  normalizePatch,
} from "./boardNormalizer.js";

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function placementNumber(value) {
  const placement = finiteNumber(value);
  return Number.isInteger(placement) && placement >= 1 && placement <= 8
    ? placement
    : null;
}

function canonicalAugmentId(value) {
  if (typeof value !== "string") return null;
  return canonicalizeIdentifier(value);
}

function participantAugments(participant) {
  if (Object.hasOwn(participant || {}, "augments")) {
    if (!Array.isArray(participant.augments)) return [];
    return participant.augments.map(canonicalAugmentId).filter(Boolean);
  }

  return null;
}

function participantSetNumber(participant) {
  return finiteNumber(
    participant?.tft_set_number ?? participant?.setNumber ?? participant?.set,
  );
}

function setNumberFromUnitNamespace(participants) {
  const setNumbers = new Set();

  for (const participant of participants) {
    for (const unit of Array.isArray(participant?.units)
      ? participant.units
      : []) {
      const unitId = String(
        unit?.character_id ?? unit?.characterId ?? unit?.apiName ?? "",
      );
      const match = unitId.match(/^TFT(\d+)_/i);
      if (match) setNumbers.add(Number(match[1]));
    }
  }

  return setNumbers.size === 1 ? [...setNumbers][0] : null;
}

function matchSetNumber(info) {
  const explicit = finiteNumber(
    info.tft_set_number ?? info.setNumber ?? info.set,
  );
  if (explicit !== null) return explicit;

  const participantSets = new Set(
    info.participants.map(participantSetNumber).filter((value) => value !== null),
  );
  if (participantSets.size === 1) return [...participantSets][0];

  // Riot payloads do not always expose a set field. A consistent TFT unit
  // namespace is the last-resort signal; mixed namespaces remain unknown.
  return setNumberFromUnitNamespace(info.participants);
}

export function parseRiotMatchPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Riot match payload must be a JSON object.");
  }

  const metadata = payload.metadata || {};
  const info = payload.info || payload;
  const matchId = String(
    metadata.match_id || payload.matchId || payload.match_id || "",
  ).trim();

  if (!matchId) {
    throw new Error("Riot match payload is missing metadata.match_id.");
  }

  if (!Array.isArray(info.participants)) {
    throw new Error(`Match ${matchId} is missing info.participants.`);
  }

  const gameVersion = info.game_version || info.gameVersion || null;
  const setNumber = matchSetNumber(info);
  const importedAt = options.importedAt || new Date().toISOString();

  return {
    matchId,
    set: setNumber,
    setNumber,
    gameVersion: gameVersion ? String(gameVersion) : null,
    patch: info.patch || normalizePatch(gameVersion),
    queueType: info.queue_id ?? info.queueId ?? info.queue_type ?? null,
    importedAt,
    participants: info.participants.map((participant, index) => ({
      participantId: String(
        participant.puuid ||
          participant.participant_id ||
          participant.summoner_id ||
          `participant-${index + 1}`,
      ),
      placement: placementNumber(participant.placement),
      level: finiteNumber(participant.level),
      augments: participantAugments(participant),
      units: Array.isArray(participant.units) ? participant.units : [],
      traits: Array.isArray(participant.traits) ? participant.traits : [],
      companion: {
        companion: participant.companion || null,
        goldLeft: finiteNumber(participant.gold_left),
        lastRound: finiteNumber(participant.last_round),
        playersEliminated: finiteNumber(participant.players_eliminated),
        timeEliminated: finiteNumber(participant.time_eliminated),
        totalDamageToPlayers: finiteNumber(
          participant.total_damage_to_players,
        ),
      },
    })),
    rawSource: options.includeRaw === false ? null : payload,
  };
}

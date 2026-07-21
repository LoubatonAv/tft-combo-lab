import { normalizePatch } from "./boardNormalizer.js";

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

function stringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function participantAugments(participant) {
  const direct = stringArray(participant?.augments);
  if (direct.length) return direct;

  return [participant?.augment1, participant?.augment2, participant?.augment3]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
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
  const setNumber = finiteNumber(
    info.tft_set_number ?? info.setNumber ?? info.set,
  );
  const importedAt = options.importedAt || new Date().toISOString();

  return {
    matchId,
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

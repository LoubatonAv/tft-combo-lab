import {
  canonicalizeIdentifier,
  createChampionIndex,
  normalizeFinalBoard,
} from "./boardNormalizer.js";
import { DEFAULT_SIMILARITY_WEIGHTS } from "./boardSimilarity.js";

export class ClientInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClientInputError";
    this.statusCode = 400;
  }
}

function rawUnitId(unit) {
  return canonicalizeIdentifier(
    unit?.character_id ||
      unit?.characterId ||
      unit?.apiName ||
      unit?.characterName ||
      unit?.unitId ||
      unit?.id,
  );
}

function validateWeights(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClientInputError("weights must be an object.");
  }

  const allowed = new Set(Object.keys(DEFAULT_SIMILARITY_WEIGHTS));
  const weights = {};

  for (const [name, rawWeight] of Object.entries(value)) {
    if (!allowed.has(name)) {
      throw new ClientInputError(`Unknown similarity weight: ${name}.`);
    }

    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new ClientInputError(
        `Similarity weight ${name} must be a non-negative number.`,
      );
    }
    weights[name] = weight;
  }

  const effective = {
    ...DEFAULT_SIMILARITY_WEIGHTS,
    ...weights,
  };
  if (!Object.values(effective).some((weight) => weight > 0)) {
    throw new ClientInputError("At least one similarity weight must be positive.");
  }

  return weights;
}

export function parseBoardStatsRequest(body, data) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ClientInputError("Request body must be a JSON object.");
  }

  const candidateInput = body.candidateBoard;
  if (
    !candidateInput ||
    typeof candidateInput !== "object" ||
    Array.isArray(candidateInput)
  ) {
    throw new ClientInputError("candidateBoard is required.");
  }

  if (!Array.isArray(candidateInput.units) || candidateInput.units.length === 0) {
    throw new ClientInputError(
      "candidateBoard.units must contain at least one unit.",
    );
  }

  const setValue = body.set ?? body.setNumber ?? candidateInput.setNumber;
  const setNumber = Number(setValue);
  if (!Number.isInteger(setNumber) || setNumber <= 0) {
    throw new ClientInputError("set must be a positive integer.");
  }

  let patch = null;
  if (body.patch !== undefined && body.patch !== null) {
    patch = String(body.patch).trim();
    if (!patch) throw new ClientInputError("patch cannot be empty.");
  }

  const minimumSimilarity = Number(body.minimumSimilarity ?? 0.65);
  if (
    !Number.isFinite(minimumSimilarity) ||
    minimumSimilarity < 0 ||
    minimumSimilarity > 1
  ) {
    throw new ClientInputError(
      "minimumSimilarity must be a number between 0 and 1.",
    );
  }

  const minimumSampleSize = Number(body.minimumSampleSize ?? 5);
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 1) {
    throw new ClientInputError(
      "minimumSampleSize must be an integer of at least 1.",
    );
  }

  const championIndex = createChampionIndex(data.champions || []);
  const seenUnitIds = new Set();

  for (const unit of candidateInput.units) {
    const unitId = rawUnitId(unit);
    if (!unitId || !championIndex.has(unitId)) {
      throw new ClientInputError(
        `Unknown candidate unit ID: ${unitId || "missing"}.`,
      );
    }

    const canonicalId = championIndex.get(unitId).unitId;
    if (seenUnitIds.has(canonicalId)) {
      throw new ClientInputError(`Duplicate candidate unit: ${canonicalId}.`);
    }
    seenUnitIds.add(canonicalId);

    const explicitStar = unit.tier ?? unit.starLevel ?? unit.stars;
    const plannedStar = candidateInput.starPlans?.[unit.id]?.starLevel;
    const starValue = explicitStar ?? plannedStar;
    if (starValue !== undefined && starValue !== null) {
      const starLevel = Number(starValue);
      if (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 4) {
        throw new ClientInputError(
          `Invalid star level for ${canonicalId}; expected an integer from 1 to 4.`,
        );
      }
    }
  }

  const contextPatch =
    patch ||
    (candidateInput.patch ? String(candidateInput.patch).trim() : null);
  const candidateBoard = normalizeFinalBoard(
    {
      ...candidateInput,
      setNumber,
      patch: contextPatch,
    },
    { champions: data.champions || [], traits: data.traits || [] },
  );

  return {
    candidateBoard,
    setNumber,
    patch,
    minimumSimilarity,
    minimumSampleSize,
    weights: validateWeights(body.weights),
  };
}


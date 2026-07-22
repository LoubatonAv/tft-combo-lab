import { normalizeFinalBoard } from "./boardNormalizer.js";
import { parseRiotMatchPayload } from "./riotMatchParser.js";

export function normalizeParsedMatch(parsedMatch, options = {}) {
  return {
    ...parsedMatch,
    participants: parsedMatch.participants.map((participant) => ({
      participantId: participant.participantId,
      placement: participant.placement,
      level: participant.level,
      augments: participant.augments,
      companion: participant.companion,
      board: normalizeFinalBoard(
        {
          setNumber: parsedMatch.set ?? parsedMatch.setNumber,
          patch: parsedMatch.patch,
          gameVersion: parsedMatch.gameVersion,
          units: participant.units,
          traits: participant.traits,
        },
        options,
      ),
    })),
  };
}

export function importRiotPayload(payload, options = {}) {
  return normalizeParsedMatch(parseRiotMatchPayload(payload, options), options);
}

export async function importRiotPayloads({
  payloads,
  repository,
  champions = [],
  traits = [],
  includeRaw = true,
  importedAt,
}) {
  const values = Array.isArray(payloads) ? payloads : [payloads];
  const matches = values.map((payload) =>
    importRiotPayload(payload, {
      champions,
      traits,
      includeRaw,
      importedAt,
    }),
  );

  return repository.saveImportedMatches(matches);
}

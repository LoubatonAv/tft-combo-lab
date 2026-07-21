/**
 * @typedef {Object} NormalizedBoardUnit
 * @property {string} unitId
 * @property {number|null} starLevel
 * @property {string[]} itemIds
 * @property {number|null} cost
 */

/**
 * @typedef {Object} NormalizedBoardTrait
 * @property {string} traitId
 * @property {number|null} unitCount
 * @property {number|null} activeTier
 */

/**
 * @typedef {Object} NormalizedFinalBoard
 * @property {number|null} setNumber
 * @property {string|null} patch
 * @property {string|null} gameVersion
 * @property {number} boardSize
 * @property {number|null} totalUnitCost
 * @property {NormalizedBoardUnit[]} units
 * @property {NormalizedBoardTrait[]} activeTraits
 * @property {string} boardFingerprint
 * @property {string} contextFingerprint
 */

/**
 * @typedef {Object} ImportedParticipant
 * @property {string} participantId
 * @property {number|null} placement
 * @property {number|null} level
 * @property {string[]} augments
 * @property {NormalizedFinalBoard} board
 * @property {Object} companion
 */

/**
 * @typedef {Object} ImportedMatch
 * @property {string} matchId
 * @property {number|null} setNumber
 * @property {string|null} gameVersion
 * @property {string|null} patch
 * @property {number|string|null} queueType
 * @property {string} importedAt
 * @property {ImportedParticipant[]} participants
 * @property {Object|null} rawSource
 */

export const MATCH_STORE_SCHEMA_VERSION = 2;

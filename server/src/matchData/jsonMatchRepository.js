import fs from "node:fs/promises";
import path from "node:path";
import { MATCH_STORE_SCHEMA_VERSION } from "./models.js";
import {
  createBoardFingerprint,
  createContextFingerprint,
} from "./boardNormalizer.js";

function emptyStore() {
  return {
    schemaVersion: MATCH_STORE_SCHEMA_VERSION,
    matches: [],
    derivedBoardStatistics: [],
  };
}

function matchesFilter(value, filter) {
  const storedSetNumber = value.set ?? value.setNumber;
  if (
    filter.setNumber !== undefined &&
    filter.setNumber !== null &&
    Number(storedSetNumber) !== Number(filter.setNumber)
  ) {
    return false;
  }

  if (filter.patch && String(value.patch) !== String(filter.patch)) {
    return false;
  }

  return true;
}

function normalizeStoredBoard(board, match) {
  if (!board || !Array.isArray(board.units)) return board;

  const currentBoard = { ...board };
  delete currentBoard.fingerprint;
  const boardFingerprint =
    board.boardFingerprint || createBoardFingerprint(currentBoard);

  return {
    ...currentBoard,
    boardFingerprint,
    contextFingerprint:
      board.contextFingerprint ||
      createContextFingerprint(
        boardFingerprint,
        match.set ?? match.setNumber ?? board.setNumber,
        match.patch ?? board.patch,
      ),
  };
}

function normalizeStore(parsed) {
  const store = {
    ...emptyStore(),
    ...parsed,
    schemaVersion: MATCH_STORE_SCHEMA_VERSION,
    matches: Array.isArray(parsed.matches) ? parsed.matches : [],
    derivedBoardStatistics: Array.isArray(parsed.derivedBoardStatistics)
      ? parsed.derivedBoardStatistics
      : [],
  };

  store.matches = store.matches.map((match) => ({
    ...match,
    participants: (match.participants || []).map((participant) => ({
      ...participant,
      board: normalizeStoredBoard(participant.board, match),
    })),
  }));

  return store;
}

function validPlacement(value) {
  const placement = Number(value);
  return Number.isInteger(placement) && placement >= 1 && placement <= 8
    ? placement
    : null;
}

function derivedBoardStatistics(matches) {
  const groups = new Map();

  for (const match of matches) {
    for (const participant of match.participants || []) {
      const contextFingerprint = participant.board?.contextFingerprint;
      const boardFingerprint = participant.board?.boardFingerprint;
      if (!contextFingerprint || !boardFingerprint) continue;

      const current = groups.get(contextFingerprint) || {
        contextFingerprint,
        boardFingerprint,
        setNumber: match.set ?? match.setNumber,
        patch: match.patch,
        similarBoardCount: 0,
        placementTotal: 0,
        placementSamples: 0,
        top4Count: 0,
        winCount: 0,
      };
      const placement = validPlacement(participant.placement);

      current.similarBoardCount += 1;
      if (placement !== null) {
        current.placementTotal += placement;
        current.placementSamples += 1;
        if (placement <= 4) current.top4Count += 1;
        if (placement === 1) current.winCount += 1;
      }

      groups.set(contextFingerprint, current);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      contextFingerprint: group.contextFingerprint,
      boardFingerprint: group.boardFingerprint,
      setNumber: group.setNumber,
      patch: group.patch,
      sampleSize: group.placementSamples,
      similarBoardCount: group.similarBoardCount,
      averagePlacement: group.placementSamples
        ? group.placementTotal / group.placementSamples
        : null,
      top4Rate: group.placementSamples
        ? group.top4Count / group.placementSamples
        : null,
      winRate: group.placementSamples
        ? group.winCount / group.placementSamples
        : null,
    }))
    .sort((a, b) => a.contextFingerprint.localeCompare(b.contextFingerprint));
}

export class JsonMatchRepository {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.writeQueue = Promise.resolve();
    this.cachedStore = null;
    this.cachedSignature = null;
  }

  async fileSignature() {
    try {
      const stats = await fs.stat(this.filePath);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch (error) {
      if (error.code === "ENOENT") return "missing";
      throw error;
    }
  }

  async readStore() {
    try {
      const signature = await this.fileSignature();

      if (this.cachedStore && signature === this.cachedSignature) {
        return this.cachedStore;
      }

      if (signature === "missing") {
        this.cachedStore = emptyStore();
        this.cachedSignature = signature;
        return this.cachedStore;
      }

      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.cachedStore = normalizeStore(parsed);
      this.cachedSignature = await this.fileSignature();
      return this.cachedStore;
    } catch (error) {
      throw new Error(
        `Could not read match store ${this.filePath}: ${error.message}`,
      );
    }
  }

  async writeStore(store) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(temporaryPath, this.filePath);
    this.cachedStore = store;
    this.cachedSignature = await this.fileSignature();
  }

  async saveImportedMatches(matches = []) {
    const operation = this.writeQueue.then(async () => {
      const store = structuredClone(await this.readStore());
      const knownIds = new Set(store.matches.map((match) => match.matchId));
      const imported = [];
      const duplicates = [];

      for (const match of matches) {
        if (!match?.matchId) {
          throw new Error("Cannot save an imported match without matchId.");
        }

        if (knownIds.has(match.matchId)) {
          duplicates.push(match.matchId);
          continue;
        }

        knownIds.add(match.matchId);
        store.matches.push(match);
        imported.push(match.matchId);
      }

      if (imported.length) {
        store.derivedBoardStatistics = [];
        await this.writeStore(store);
      }

      return {
        importedCount: imported.length,
        duplicateCount: duplicates.length,
        importedMatchIds: imported,
        duplicateMatchIds: duplicates,
        totalMatches: store.matches.length,
      };
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async hasMatch(matchId) {
    const store = await this.readStore();
    return store.matches.some((match) => match.matchId === matchId);
  }

  async queryParticipants(filter = {}) {
    const store = await this.readStore();

    return store.matches
      .filter((match) => matchesFilter(match, filter))
      .flatMap((match) =>
        (match.participants || []).map((participant) => ({
          matchId: match.matchId,
          setNumber: match.set ?? match.setNumber,
          patch: match.patch,
          gameVersion: match.gameVersion,
          queueType: match.queueType,
          importedAt: match.importedAt,
          ...participant,
        })),
      );
  }

  async queryNormalizedBoards(filter = {}) {
    const participants = await this.queryParticipants(filter);
    return participants.filter((participant) => participant.board);
  }

  async countSamples(filter = {}) {
    return (await this.queryNormalizedBoards(filter)).length;
  }

  async rebuildDerivedBoardStatistics() {
    const operation = this.writeQueue.then(async () => {
      const store = structuredClone(await this.readStore());
      store.derivedBoardStatistics = derivedBoardStatistics(store.matches);

      await this.writeStore(store);
      return store.derivedBoardStatistics;
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async replaceMatchesAndRebuildStatistics(matches) {
    const operation = this.writeQueue.then(async () => {
      const store = structuredClone(await this.readStore());
      store.matches = structuredClone(matches);
      store.derivedBoardStatistics = derivedBoardStatistics(store.matches);
      await this.writeStore(store);
      return {
        totalMatches: store.matches.length,
        derivedStatisticGroups: store.derivedBoardStatistics.length,
      };
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }
}

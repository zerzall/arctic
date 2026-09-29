// PLACEHOLDER written by the lead so shared/room.js can import BotBrain while the bots engineer works.
// The bots engineer replaces this file wholesale (contract: docs/SPEC.md §6, §6.1).
export class BotBrain {
  constructor({ level = 'normal', seed = 0 } = {}) { this.level = level; this.seed = seed; }
  think(_world, _playerId) { return { d: 0, b: 0, x: 0 }; }
}

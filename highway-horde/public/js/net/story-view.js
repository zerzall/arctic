// The story state a session exposes to the UI (`session.story`), and the actions it offers.
// The host's StoryHost (story-host.js) and a client's StoryClient (story-client.js) share
// this surface, so the UI never cares which side it runs on:
//
//   story.stage        'lobby' | 'hideout' | 'briefing' | 'mission' | 'debrief'
//   story.world        the crew's World (a copy on clients, the authority on the host)
//   story.profile      the local player's Profile (as the host accepted it)
//   story.missionId / story.mission     the mission being briefed / played
//   story.party        pids of the players in the current stage
//   story.ready        pids that pressed ready in the briefing
//   story.debrief      the result screen data after a mission, else null
//
//   session.on('story', ({ kind, ... }))
//     kind 'state'   the stage, party or ready list changed
//     kind 'profile' { profile }  the local profile changed: persist it
//     kind 'world'   { world }    the world changed: persist it
//     kind 'result'  { a, ok, reason, note }  the outcome of an action you asked for
//     kind 'debrief' { debrief }  a mission ended
//
// Every action returns nothing: watch the events. Each is validated on the host.

import { getMission } from '../shared/story/content.js';

export class StoryView {
  /** @param {object} session the owning Host/ClientSession */
  constructor(session) {
    this.session = session;
    this.stage = 'lobby';
    this.world = null;
    this.profile = null;
    this.missionId = null;
    this.party = [];
    this.ready = [];
    this.debrief = null;
    /** The hideout / mission map ids of the running stage (informational). */
    this.stageInfo = null;
  }

  /** The mission being briefed or played (content lookup), or null. */
  get mission() {
    return this.missionId ? getMission(this.missionId) : null;
  }

  _emit(kind, data = {}) {
    this.session.emit('story', { kind, ...data });
  }

  /** @abstract send/perform one action */
  _act() {
    throw new Error('not implemented');
  }

  // ---- station actions (any player) ---------------------------------------------------

  /** Workbench/armory: choose the three guns taken into a mission. */
  setLoadout(loadout) { this._act({ a: 'loadout', loadout }); }
  /** Workbench: raise an owned gun one tier. */
  upgradeWeapon(weapon) { this._act({ a: 'tier', weapon }); }
  /** Workbench: buy a gun with scrap. */
  buyWeapon(weapon) { this._act({ a: 'buygun', weapon }); }
  /** Perk tree: take the next rank of a perk. */
  buyPerk(perk) { this._act({ a: 'perk', perk }); }
  /** Infirmary: refund every perk point (free once per chapter). */
  resetPerks() { this._act({ a: 'reset' }); }
  /** Upgrade board: raise a hideout upgrade line one tier from the stash. */
  upgradeHideout(id) { this._act({ a: 'hideout', id }); }
  /** Upgrade board: give scrap to the stash. */
  donate(scrap) { this._act({ a: 'donate', scrap }); }
  /** Armory: take (n > 0) or put back (n < 0) supplies from the stash. */
  takeKit(item, n = 1) { this._act({ a: 'kit', item, n }); }
  /** Armory: buy one supply into the stash with your scrap. */
  buyKit(item) { this._act({ a: 'buykit', item }); }
  /** Infirmary: patch yourself up (hideout only). */
  heal() { this._act({ a: 'heal' }); }
  /** Note a conversation (sets a story flag the dialogue can use). */
  talked(npc) { this._act({ a: 'talk', npc }); }

  // ---- crew actions (the host decides) -------------------------------------------------

  /** Host: change the campaign's difficulty. */
  setDifficulty(difficulty) { this._act({ a: 'diff', difficulty }); }
  /** Host: rename the campaign. */
  renameWorld(name) { this._act({ a: 'rename', name }); }
  /** Host, at the mission board: brief the crew on a mission. */
  pickMission(mission) { this._act({ a: 'pick', mission }); }
  /** Host: back out of the briefing. */
  cancelBriefing() { this._act({ a: 'unpick' }); }
  /** Everyone: in the briefing, ready or not. */
  setReady(ready) { this._act({ a: 'ready', ready: !!ready }); }
  /** Host: send the crew out on the briefed mission. */
  deploy() { this._act({ a: 'deploy' }); }
  /** Host, after a mission: back to the hideout. */
  backToHideout() { this._act({ a: 'back' }); }
  /** Host, after a lost mission: try it again. */
  retry() { this._act({ a: 'retry' }); }
}

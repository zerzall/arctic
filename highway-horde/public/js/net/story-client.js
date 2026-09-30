// A joining player's mirror of the story campaign (STORY.md §5.5): the world copy, this
// player's accepted profile, the stage the host is running, and the actions to ask for
// things. Messages from the host arrive through ClientSession (see story-host.js for the
// catalogue); everything the UI needs is on the shared StoryView surface.

import { sanitizeWorld } from '../shared/story/world.js';
import { sanitizeProfile } from '../shared/story/profile.js';
import { StoryView } from './story-view.js';

const STAGES = ['lobby', 'hideout', 'briefing', 'mission', 'debrief'];

export class StoryClient extends StoryView {
  /**
   * @param {object} session the ClientSession
   * @param {{ world: object, profile: object, state: object, pid?: number }} info the welcome's `story`
   * @param {object|null} localWorld this browser's own copy of the campaign (answers a `swant`)
   */
  constructor(session, info, localWorld = null) {
    super(session);
    this.isHost = false;
    this.localWorld = localWorld;
    this.world = sanitizeWorld(info.world).world;
    this.profile = sanitizeProfile(info.profile).profile;
    this._setState(info.state);
    if (info.debrief && typeof info.debrief === 'object' && this.stage === 'debrief') this.debrief = info.debrief;
    // The welcome carries the first copy of everything: hand it to the UI (to persist) on
    // the next task, once the caller has had the chance to subscribe.
    setTimeout(() => {
      if (this.world) this._emit('world', { world: this.world });
      if (this.profile) this._emit('profile', { profile: this.profile });
    }, 0);
  }

  _act(act) {
    this.session._sendCtl({ t: 'sact', ...act });
  }

  _setState(s) {
    if (!s || typeof s !== 'object') return;
    if (STAGES.includes(s.stage)) this.stage = s.stage;
    this.missionId = typeof s.mission === 'string' ? s.mission : null;
    this.party = Array.isArray(s.party) ? s.party.filter((n) => Number.isInteger(n)) : [];
    this.ready = Array.isArray(s.ready) ? s.ready.filter((n) => Number.isInteger(n)) : [];
    if (this.stage !== 'debrief') this.debrief = null;
  }

  stateInfo() {
    return {
      stage: this.stage, mission: this.missionId, party: this.party, ready: this.ready,
      hideout: this.world ? this.world.hideout.current : null,
    };
  }

  /** The `story` part of a start message: a new game of the next stage. */
  onStart(info) {
    this._setState(info);
    this.stageInfo = { map: info.map || null };
    this._emit('state', this.stateInfo());
  }

  onLobby() {
    this.stage = 'lobby';
    this.missionId = null;
    this.party = [];
    this.ready = [];
    this.debrief = null;
    this._emit('state', this.stateInfo());
  }

  /** A story message from the host that ClientSession does not know. */
  onMessage(data) {
    switch (data.t) {
      case 'world': {
        const { world } = sanitizeWorld(data.world);
        if (world && this.world && world.id === this.world.id) {
          this.world = world;
          this._emit('world', { world });
        }
        break;
      }
      case 'sprofile': {
        const { profile } = sanitizeProfile(data.profile);
        if (profile) {
          this.profile = profile;
          this._emit('profile', { profile });
        }
        break;
      }
      case 'sstate':
        this._setState(data);
        this._emit('state', this.stateInfo());
        break;
      case 'sdebrief':
        if (data.debrief && typeof data.debrief === 'object') {
          this.stage = 'debrief';
          this.debrief = data.debrief;
          this._emit('debrief', { debrief: data.debrief });
          this._emit('state', this.stateInfo());
        }
        break;
      case 'sres':
        this._emit('result', {
          a: String(data.a || ''), ok: !!data.ok, reason: typeof data.reason === 'string' ? data.reason : undefined, note: data.note,
        });
        break;
      case 'swant':
        // the host runs an older copy of this campaign than ours: offer ours
        if (this.localWorld && data.id === this.localWorld.id) this._act({ a: 'sync', world: this.localWorld });
        break;
      default:
    }
  }
}

// The single wiring point for the story's content (missions, cast, dialogue).
//
// The engine, the session and the UI ask the registry in shared/story/content.js and never
// import content files themselves. Until the real content modules are merged, the stub
// content stands in.
//
// INTEGRATION (when shared/story/{missions,cast,dialogue}.js land): replace the stub import
// and the call below with
//
//   import * as missions from '../shared/story/missions.js';
//   import * as cast from '../shared/story/cast.js';
//   import * as dialogue from '../shared/story/dialogue.js';
//   setStoryContent({ missions, cast, dialogue });
//
// setStoryContent() accepts module namespaces or plain arrays/objects: missions may be the
// array itself or a module exporting MISSIONS; cast an object by id (or CAST); dialogue
// whatever dialogue.js exports (scenes / SCENES by id, `talk(npc, ctx)` or `talks[npc]`).

import { setStoryContent } from '../shared/story/content.js';
import { STUB_CONTENT } from '../shared/story/stub-content.js';

export function installStoryContent() {
  setStoryContent(STUB_CONTENT);
}

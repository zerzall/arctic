// The single wiring point for the story's content (missions, cast, dialogue).
//
// The engine, the session and the UI ask the registry in shared/story/content.js and never
// import content files themselves. This installs the written campaign, Road to Haven: the whole
// `shared/story/index.js` module (MISSIONS, CHAPTERS, CAST, DIALOGUE, EPILOGUE and its helpers
// nextNodes, conversation, stageFor, conditionMet, expandTokens, npcAvailable).
//
// `shared/story/stub-content.js` (a handful of missions on existing maps, with a `stub` field)
// stays for the unit tests and tools that want a small campaign: install it with
// `setStoryContent(STUB_CONTENT)`.

import { setStoryContent } from '../shared/story/content.js';
import * as story from '../shared/story/index.js';

export function installStoryContent() {
  setStoryContent({ story });
}

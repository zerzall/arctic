// The single wiring point for the story's content (missions, cast, dialogue).
//
// The engine, the session and the UI ask the registry in shared/story/content.js and never
// import content files themselves. Until the real story data (shared/story/index.js and the
// files behind it: missions.js, cast.js, dialogue.js) is part of the tree, the stub content
// stands in (a handful of missions on existing maps, enough to play the whole loop).
//
// INTEGRATION, once shared/story/index.js exists: replace the stub import and the call below
// with these two lines and nothing else:
//
//   import * as story from '../shared/story/index.js';
//   setStoryContent({ story });
//
// setStoryContent() takes the whole index module: MISSIONS, CHAPTERS, CAST, DIALOGUE,
// EPILOGUE / EPILOGUE_FLAG and its helpers (nextNodes, conversation, stageFor, conditionMet,
// expandTokens). tests/story-real-content.test.js fails when the data is there and this file
// still installs the stub.

import { setStoryContent } from '../shared/story/content.js';
import { STUB_CONTENT } from '../shared/story/stub-content.js';

export function installStoryContent() {
  setStoryContent(STUB_CONTENT);
}

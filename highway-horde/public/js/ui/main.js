// Entry point loaded by index.html: boots the UI with the real session, renderer and
// audio modules. (The dev sandbox boots the same app.js with a mock session instead.)
//
// The first-person renderer pulls in three.js (~1.3 MB), so it loads in the background
// after the title screen is up: a failure there (old browser, no import maps) must never
// stop the menus or the classic top-down view from working. app.js waits for it if a game
// starts before it arrives.

import { hostGame, joinGame, getServerInfo } from '../net/session.js';
import { createRenderer, renderMapPreview, renderClassPortrait } from '../render/renderer.js';
import { createAudio } from '../audio/audio.js';
import { MAP_LIST, buildMap } from '../shared/maps.js';
import { startApp } from './app.js';
import { installStoryContent } from './story-content.js';

const deps = {
  hostGame,
  joinGame,
  getServerInfo,
  createRenderer,
  renderMapPreview,
  renderClassPortrait,
  createAudio,
  MAP_LIST,
  buildMap,
  createRenderer3D: null,
  isWebGLAvailable: null,
  renderer3dReady: null,
};

deps.renderer3dReady = import('../render3d/renderer3d.js')
  .then((m) => {
    deps.createRenderer3D = m.createRenderer3D;
    deps.isWebGLAvailable = m.isWebGLAvailable;
  })
  .catch((err) => {
    deps.renderer3dFailed = true;
    console.warn('[ui] first-person renderer unavailable, the classic view will be used:', err && err.message ? err.message : err);
  });

installStoryContent();
startApp(deps);

// Entry point loaded by index.html: boots the UI with the real session, renderer and
// audio modules. (The dev sandbox boots the same app.js with a mock session instead.)

import { hostGame, joinGame, getServerInfo } from '../net/session.js';
import { createRenderer, renderMapPreview, renderClassPortrait } from '../render/renderer.js';
import { createAudio } from '../audio/audio.js';
import { MAP_LIST, buildMap } from '../shared/maps.js';
import { startApp } from './app.js';

startApp({
  hostGame,
  joinGame,
  getServerInfo,
  createRenderer,
  renderMapPreview,
  renderClassPortrait,
  createAudio,
  MAP_LIST,
  buildMap,
});

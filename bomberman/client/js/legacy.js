// legacy.js - loaded through <script nomodule>, so ONLY a browser that cannot run ES modules ever executes it.
//
// It does not wait for the boot.js watchdog: such a browser will never start the game, so the message appears at once.
// ES5 only, self-contained (boot.js may not have run), no eval. The text matches boot.js.
(function () {
  'use strict';

  var boot = document.getElementById('boot');
  if (!boot || window.__bpFailed) return;
  window.__bpFailed = true;

  boot.className = 'failed';
  boot.setAttribute('role', 'alert');
  while (boot.firstChild) boot.removeChild(boot.firstChild);

  var title = document.createElement('strong');
  title.textContent = 'Oops!';
  var message = document.createElement('span');
  message.textContent = 'Blast Party could not start. It needs iPhone/iPad iOS 16+, Chrome 90+, Firefox 100+ or Edge 90+. Please update your browser.';
  boot.appendChild(title);
  boot.appendChild(message);
})();

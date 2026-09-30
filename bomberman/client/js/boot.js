// boot.js - the first script on the page, and the only one that must survive an old browser.
//
// A classic script, ES5 only (no modules, no arrow functions, no let/const), no eval: docs/SPEC.md section 8.3.
// When the module graph cannot load (a syntax error on an old phone, a 404, a blocked script) the page would otherwise
// sit on "Loading Blast Party..." forever. This file makes that failure visible:
//
//   * every uncaught error and failed <script> load is recorded and listed under the loading text;
//   * if main.js has not announced itself by setting window.__bpReady within 8 seconds, #boot is replaced by a
//     plain-language "please update your browser" message plus the recorded errors;
//   * with ?debug=1 a small overlay lists the last errors (and any info main.js pushes) from the very first moment.
//
// Contract with main.js: set `window.__bpReady = true` and remove #boot once the title screen is showing.
// Extras it may use: `window.__bpErrors` (the last five error strings), `window.__bpDebug` (only with ?debug=1):
// `{ el, info(text) }`, where info() sets the overlay's first lines above the error list.
(function () {
  'use strict';

  var WATCHDOG_MS = 8000;
  var KEEP_ERRORS = 5;
  var MESSAGE = 'Blast Party could not start. It needs iPhone/iPad iOS 16+, Chrome 90+, Firefox 100+ or Edge 90+. Please update your browser.';

  var errors = [];
  var info = '';
  var debugEl = null;
  window.__bpErrors = errors;

  function bootEl() {
    return document.getElementById('boot');
  }

  function shortFile(url) {
    return String(url || '').split('?')[0].split('/').pop();
  }

  function renderDebug() {
    if (!debugEl) return;
    debugEl.textContent = (info ? info + '\n' : '') + (errors.length ? 'errors:\n' + errors.join('\n') : 'no errors');
  }

  function renderProgress() {
    var boot = bootEl();
    if (!boot || window.__bpReady || window.__bpFailed) return;
    var pre = boot.querySelector('pre');
    if (!pre) {
      pre = document.createElement('pre');
      boot.appendChild(pre);
    }
    pre.textContent = errors.join('\n');
  }

  function record(text) {
    errors.push(text);
    while (errors.length > KEEP_ERRORS) errors.shift();
    renderDebug();
    renderProgress();
  }

  function fail() {
    var boot = bootEl();
    if (!boot || window.__bpReady || window.__bpFailed) return;
    window.__bpFailed = true;
    boot.className = 'failed';
    boot.setAttribute('role', 'alert');
    while (boot.firstChild) boot.removeChild(boot.firstChild);

    var title = document.createElement('strong');
    title.textContent = 'Oops!';
    var message = document.createElement('span');
    message.textContent = MESSAGE;
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.onclick = function () {
      window.location.reload();
    };
    boot.appendChild(title);
    boot.appendChild(message);
    boot.appendChild(retry);
    if (errors.length) {
      var pre = document.createElement('pre');
      pre.textContent = errors.join('\n');
      boot.appendChild(pre);
    }
  }

  // Capture phase: resource errors (a script that failed to load) do not bubble, and are the usual cause of a dead boot.
  window.addEventListener('error', function (e) {
    if (window.__bpReady) return;
    var target = e.target;
    if (target && target !== window && target.tagName) {
      if (target.tagName === 'SCRIPT') record('failed to load ' + shortFile(target.src));
      return;   // a missing icon or font must not look like a crash
    }
    var where = e.filename ? ' (' + shortFile(e.filename) + ':' + (e.lineno || 0) + ')' : '';
    record(String(e.message || 'script error') + where);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    record('unhandled: ' + String((reason && reason.message) || reason));
  });

  if (/[?&]debug=1(?:&|$)/.test(window.location.search)) {
    debugEl = document.createElement('pre');
    debugEl.id = 'bp-debug';
    debugEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(debugEl);
    window.__bpDebug = {
      el: debugEl,
      info: function (text) {
        info = String(text);
        renderDebug();
      },
    };
    renderDebug();
  }

  window.__bpFail = fail;
  window.setTimeout(fail, WATCHDOG_MS);
})();

/*
 * store-page.js — store-only wiring for fretboard-builder.html (runs after engine/app.js).
 * - keeps the address bar holding a shareable link to the current design (#design=...)
 * - "Copy link to this design" button
 * - the disabled "Order this" hook (see ORDERING.md); nothing here touches the cart or Stripe
 */
(function () {
  'use strict';
  var D = window.FretboardDesign;
  var rootEl = document.getElementById('fb-builder');
  if (!D || !rootEl) return;
  var engine = rootEl.getAttribute('data-engine-version') || 'unknown';
  var status = document.getElementById('fb-share-status');
  var shareBtn = document.getElementById('fb-share');
  var orderBtn = document.getElementById('fb-order');

  function current() { return D.readForm(document, engine); }
  D.current = current;

  function say(msg) { if (status) status.textContent = msg || ''; }

  if (D.loadedFromLink) {
    say(D.loadedFromLink.warnings.length
      ? 'Loaded a shared design. Some settings in the link weren’t valid and were reset to defaults.'
      : 'Loaded a shared design.');
  }

  // Keep the URL in sync (replaceState: no history spam, no page reload, never sent to a server).
  var timer = null;
  function syncUrl() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (window.history && history.replaceState) history.replaceState(null, '', D.shareUrl(current(), location.href));
    }, 250);
  }
  var controls = rootEl.querySelector('.controls');
  if (controls) {
    controls.addEventListener('input', syncUrl);
    controls.addEventListener('change', syncUrl);
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url = D.shareUrl(current(), location.href);
      if (window.history && history.replaceState) history.replaceState(null, '', url);
      var done = function () { say('Link copied. Anyone who opens it gets this exact design.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
      } else {
        window.prompt('Copy this link:', url);
      }
    });
  }

  // Future custom orders: stays hidden + disabled unless ORDERING_ENABLED is flipped on.
  if (orderBtn && D.ORDERING_ENABLED) {
    orderBtn.hidden = false;
    orderBtn.disabled = false;
    orderBtn.setAttribute('data-ordering', 'on');
    orderBtn.addEventListener('click', function () {
      D.requestOrder(current()).then(function (r) { if (!r.ok) say('Ordering isn’t available yet.'); });
    });
  }
})();

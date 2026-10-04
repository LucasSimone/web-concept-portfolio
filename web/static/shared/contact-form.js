/**
 * Form submitter for the site's two forms
 * ---------------------------------------
 * Wires every `<form data-contact-form="<kind>">` on the page to POST its
 * own fields to /api/contact as JSON, and reports the outcome in the
 * form's `.form-status` paragraph. Used by both the contact form
 * (kind "inquiry") and the bug report form (kind "bug"), which differ
 * only in their markup.
 *
 * The field set is whatever the form declares: every named control is
 * sent under its own name, so adding or dropping a field is an HTML-only
 * change. The `kind` goes along with it, and tells the backend which form
 * it was and therefore which fields it may require — see
 * internal/contact/handler.go.
 *
 * Two values a visitor shouldn't have to supply by hand are filled in on
 * load, opt-in by markup: an input carrying `data-prefill="browser"` gets
 * the browser's user-agent string, and one carrying `data-prefill="effect"`
 * gets the `?effect=` query parameter (how nav.js's "Bug" link passes
 * along which effect you were looking at). Both stay visible in the form
 * — nothing is sent that the form doesn't show.
 *
 * No-ops on a page with no such form, which is every page but two.
 */
(function () {
  var PREFILL = {
    browser: function () { return navigator.userAgent; },
    effect: function () { return new URLSearchParams(location.search).get('effect') || ''; },
  };

  function hasOption(select, value) {
    return Array.prototype.some.call(select.options, function (option) {
      return option.value === value;
    });
  }

  function prefill(form) {
    form.querySelectorAll('[data-prefill]').forEach(function (field) {
      var source = PREFILL[field.getAttribute('data-prefill')];
      if (!source) return;
      var value = source();
      if (!value) return;
      // A <select> handed a value none of its options carry silently
      // blanks itself; leave it on its default instead.
      if (field.tagName === 'SELECT' && !hasOption(field, value)) return;
      field.value = value;
    });
  }

  // The handler explains itself in {"error": "..."} JSON, but the rate
  // limiter in front of it answers in plain text (see
  // internal/httpserver/middleware.go), so read the body either way
  // rather than letting a failed JSON.parse surface as the message.
  function errorIn(body) {
    try {
      return JSON.parse(body).error || '';
    } catch (e) {
      return body.trim();
    }
  }

  function payloadOf(form) {
    var payload = { kind: form.getAttribute('data-contact-form') };
    new FormData(form).forEach(function (value, name) {
      payload[name] = value;
    });
    return payload;
  }

  function bind(form) {
    var status = form.querySelector('.form-status');
    var button = form.querySelector('button[type="submit"]');
    var success = form.getAttribute('data-success') || 'Thanks — got it.';

    function report(text, state) {
      status.textContent = text;
      if (state) {
        status.setAttribute('data-state', state);
      } else {
        status.removeAttribute('data-state');
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      report('Sending…');
      button.disabled = true;

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadOf(form)),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { ok: res.ok, error: errorIn(text) };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            report(result.error || 'Something went wrong.', 'error');
            return;
          }
          form.reset();
          // reset() wipes the prefilled fields along with the typed
          // ones, so put them back for a second submission.
          prefill(form);
          report(success, 'ok');
        })
        .catch(function () {
          report('Something went wrong. Please try again.', 'error');
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-contact-form]').forEach(function (form) {
      prefill(form);
      bind(form);
    });
  });
})();

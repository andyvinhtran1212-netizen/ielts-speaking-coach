// Shared Writing submission receipt contract for Next + legacy dashboards.
// A receipt is account/assignment keyed and contains the exact text so a
// transport failure followed by reload can retry the same idempotent request
// without falling back to an older server draft. sessionStorage is deliberate:
// it is tab-scoped, never crosses accounts, and is cleared after canonical ACK.
(function () {
  'use strict';

  var PREFIX = 'writing-submit:v1:';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var TERMINAL = { submitted: true, grading: true, graded: true, reviewed: true, delivered: true, failed: true };
  // Web Storage can be denied by browser privacy policy or fail on quota.
  // Keep the current-tab retry contract alive in memory even when reload
  // reconciliation is unavailable; storage is durability, not permission to
  // submit.
  var memory = Object.create(null);

  function key(account, assignmentId) {
    return PREFIX + encodeURIComponent(account) + ':' + encodeURIComponent(assignmentId);
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var account = typeof raw.account === 'string' ? raw.account : '';
    var assignmentId = typeof raw.assignmentId === 'string' ? raw.assignmentId : '';
    var requestId = typeof raw.requestId === 'string' ? raw.requestId : '';
    var essayText = typeof raw.essayText === 'string' ? raw.essayText : null;
    if (!account || !assignmentId || !UUID_RE.test(requestId) || essayText === null) return null;
    return {
      account: account,
      assignmentId: assignmentId,
      requestId: requestId,
      essayText: essayText,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    };
  }

  function read(account, assignmentId) {
    var storageKey = key(account, assignmentId);
    try {
      var raw = sessionStorage.getItem(storageKey);
      if (!raw) return memory[storageKey] || null;
      var receipt = normalize(JSON.parse(raw));
      if (!receipt || receipt.account !== account || receipt.assignmentId !== assignmentId) {
        sessionStorage.removeItem(storageKey);
        delete memory[storageKey];
        return null;
      }
      memory[storageKey] = receipt;
      return receipt;
    } catch (_) {
      return memory[storageKey] || null;
    }
  }

  function write(receipt) {
    var normalized = normalize(receipt);
    if (!normalized) throw new TypeError('invalid-writing-submit-receipt');
    var storageKey = key(normalized.account, normalized.assignmentId);
    memory[storageKey] = normalized;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch (_) {
      // Submission remains safe for this page lifetime through `memory`.
    }
    return normalized;
  }

  function begin(account, assignmentId, essayText) {
    var existing = read(account, assignmentId);
    if (existing) return existing;
    return write({
      account: account,
      assignmentId: assignmentId,
      requestId: randomId(),
      essayText: String(essayText == null ? '' : essayText),
      createdAt: new Date().toISOString(),
    });
  }

  function remove(account, assignmentId) {
    var storageKey = key(account, assignmentId);
    delete memory[storageKey];
    try { sessionStorage.removeItem(storageKey); } catch (_) {}
  }

  function list(account) {
    var out = [];
    var prefix = PREFIX + encodeURIComponent(account) + ':';
    var seen = Object.create(null);
    Object.keys(memory).forEach(function (storageKey) {
      if (storageKey.indexOf(prefix) !== 0) return;
      var receipt = memory[storageKey];
      if (receipt && receipt.account === account) {
        seen[storageKey] = true;
        out.push(receipt);
      }
    });
    try {
      for (var i = 0; i < sessionStorage.length; i += 1) {
        var storageKey = sessionStorage.key(i);
        if (!storageKey || storageKey.indexOf(prefix) !== 0 || seen[storageKey]) continue;
        var receipt = normalize(JSON.parse(sessionStorage.getItem(storageKey) || 'null'));
        if (receipt && receipt.account === account) {
          memory[storageKey] = receipt;
          out.push(receipt);
        }
      }
    } catch (_) {}
    return out;
  }

  function normalizeAck(raw, assignmentId) {
    if (!raw || typeof raw !== 'object') return null;
    var essayId = typeof raw.essay_id === 'string' ? raw.essay_id : '';
    var ackAssignment = typeof raw.assignment_id === 'string' ? raw.assignment_id : '';
    var status = typeof raw.status === 'string' ? raw.status : '';
    if (!essayId || ackAssignment !== assignmentId || !TERMINAL[status]) return null;
    return {
      essayId: essayId,
      assignmentId: ackAssignment,
      status: status,
      isFlagged: raw.is_flagged === true,
      message: typeof raw.message === 'string' ? raw.message : '',
      replayed: raw.replayed === true,
    };
  }

  window.WritingSubmitReceipt = Object.freeze({
    begin: begin,
    list: list,
    normalize: normalize,
    normalizeAck: normalizeAck,
    read: read,
    remove: remove,
    write: write,
  });
})();

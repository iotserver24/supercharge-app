/* Plugin UI Host client — postMessage SDK (P0). */
(function (global) {
  "use strict";
  function request(method, params) {
    var id = "h" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    return new Promise(function (resolve, reject) {
      if (!global.parent || global.parent === global) {
        reject({ code: "E_NO_HOST", message: "not embedded" });
        return;
      }
      var timeout = global.setTimeout(function () {
        global.removeEventListener("message", onMsg);
        reject({ code: "E_TIMEOUT", message: "host request timed out" });
      }, 30000);
      function onMsg(ev) {
        var d = ev.data;
        if (!d || d.v !== 1 || d.type !== "res" || d.id !== id) return;
        global.clearTimeout(timeout);
        global.removeEventListener("message", onMsg);
        if (d.ok) resolve(d.result);
        else reject(d.error || { code: "E_HOST", message: "request failed" });
      }
      global.addEventListener("message", onMsg);
      global.parent.postMessage(
        { v: 1, id: id, type: "req", method: method, params: params },
        "*",
      );
    });
  }
  global.host = {
    getInfo: function () { return request("host.getInfo"); },
    theme: { get: function () { return request("host.theme.get"); } },
    locale: { get: function () { return request("host.locale.get"); } },
    focus: { pane: function () { return request("host.focus.pane"); } },
    dialog: {
      notice: function (title, body) {
        return request("host.dialog.notice", { title: title, body: body });
      },
      confirm: function (title, body) {
        return request("host.dialog.confirm", { title: title, body: body });
      },
      prompt: function (title, body) {
        return request("host.dialog.prompt", { title: title, body: body });
      },
    },
    toast: function (message, tone) {
      return request("host.toast", { message: message, tone: tone });
    },
    sessions: {
      compose: function (p) { return request("host.sessions.compose", p); },
      run: function (p) { return request("host.sessions.run", p); },
      poll: function (jobId) { return request("host.sessions.poll", { jobId: jobId }); },
      open: function (sessionId) { return request("host.sessions.open", { sessionId: sessionId }); },
      get: function (sessionId) { return request("host.sessions.get", { sessionId: sessionId }); },
    },
    storage: {
      get: function (key) { return request("host.storage.get", { key: key }); },
      set: function (key, value) { return request("host.storage.set", { key: key, value: value }); },
      list: function () { return request("host.storage.list"); },
      delete: function (key) { return request("host.storage.delete", { key: key }); },
    },
  };
})(window);

(function () {
  var logEl = document.getElementById("log");
  function log(msg) {
    logEl.textContent += String(msg) + "\n";
  }

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.v !== 1 || d.type !== "event") return;
    log("event " + d.event);
  });

  document.getElementById("btn-notice").addEventListener("click", function () {
    window.host.dialog.notice("Fixture", "host.dialog.notice").then(
      function () { log("notice ok"); },
      function (e) { log("notice err " + (e && e.message)); }
    );
  });

  document.getElementById("btn-compose").addEventListener("click", function () {
    window.host.sessions
      .compose({ title: "Fixture draft", prompt: "Say hello from the host fixture." })
      .then(function (r) { log("compose " + (r && r.sessionId)); })
      .catch(function (e) { log("compose err " + (e && e.message)); });
  });

  document.getElementById("btn-run").addEventListener("click", function () {
    window.host.sessions
      .run({
        title: "Fixture run",
        prompt: "Reply with the single word ready.",
        open: "background",
      })
      .then(function (r) { log("run " + (r && r.jobId)); })
      .catch(function (e) { log("run err " + (e && e.message)); });
  });
})();

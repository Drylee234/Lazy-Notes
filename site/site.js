// Q-notes site: the same pages run on GitHub Pages and on the Render server.
// On the server, links to the phone app stay on this site (and say "My notes"
// when you're already logged in); on GitHub Pages they go to the server.
(function () {
  var onServer = !/github\.io$/.test(location.hostname);
  var loggedIn = false;
  try { loggedIn = onServer && !!localStorage.getItem("ln-key"); } catch (_) {}
  document.querySelectorAll("[data-app]").forEach(function (a) {
    if (onServer) a.href = loggedIn ? "/app" : a.dataset.app;
    if (loggedIn) a.textContent = a.textContent === "Log in" ? "My notes" : "Open my notes";
  });
  // Download page: the zip lives next to the page on both sites.
  var ver = document.querySelector(".ver");
  if (ver) fetch("version.txt").then(function (r) { return r.ok ? r.text() : ""; })
    .then(function (t) { if (t && !/</.test(t)) ver.textContent = " (" + t.trim() + ")"; }).catch(function () {});
  document.querySelectorAll(".copy").forEach(function (b) {
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(b.dataset.copy).then(function () { b.textContent = "Copied"; }, function () { b.textContent = "Select and copy it"; });
    });
  });
  var host = document.querySelector(".site-host");
  if (host) host.textContent = onServer ? location.host : "lazy-notes-c07b.onrender.com";
})();

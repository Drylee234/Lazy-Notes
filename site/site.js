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
  // Microsoft Edge runs the same extension: its own words and edge:// address.
  if (/\bEdg\//.test(navigator.userAgent)) {
    document.querySelectorAll("[data-edge]").forEach(function (el) { el.innerHTML = el.dataset.edge; });
    document.querySelectorAll("code, .copy").forEach(function (el) {
      if (el.dataset.copy) el.dataset.copy = el.dataset.copy.replace("chrome://", "edge://");
      if (el.tagName === "CODE") el.textContent = el.textContent.replace("chrome://", "edge://");
    });
    document.querySelectorAll(".howto li").forEach(function (li) {
      li.firstChild && li.firstChild.nodeType === 3 && (li.firstChild.nodeValue = li.firstChild.nodeValue.replace("In Chrome,", "In Edge,"));
    });
    if (/for Chrome/.test(document.title)) document.title = document.title.replace("Chrome", "Edge");
  }
  var host = document.querySelector(".site-host");
  if (host) host.textContent = onServer ? location.host : "lazy-notes-c07b.onrender.com";
})();

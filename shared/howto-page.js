document.getElementById("list").innerHTML = lnHowtoHtml();
// Opening How to use is a habit worth knowing about (bg_habits.js).
try { chrome.runtime.sendMessage({ type: "HABIT", name: "howto" }); } catch (_) {}

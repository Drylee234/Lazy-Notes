// Runs the real background (the extension's service worker) inside the
// bench's hidden frame, then tells the hub messages can flow.
import "../background/background.js";
setTimeout(() => window.__lnHub?.bgReady(), 50);

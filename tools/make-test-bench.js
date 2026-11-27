#!/usr/bin/env node
// Builds the Lazy Notes test bench: the extension's real files plus a
// stand-in for Chrome's extension APIs (tools/test-bench/shim.js), as one
// folder that runs in any browser (published as a Claude artifact so the
// owner can try changes without reloading the extension).
//
//   node tools/make-test-bench.js <out-dir>
//
// Writes <out-dir>/index.html (the bench page) and every file it needs, and
// <out-dir>/files.json: { "published/path": "<out-dir>/path" } for publishing.
// Rerun after changing the extension.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "test-bench-out"));
const BENCH = path.join(__dirname, "test-bench");

// Left out: the server, docs, tools, and the readers (pdf.js alone is 4 MB,
// and the readers need real files / IndexedDB).
const SKIP = [/^server\//, /^docs\//, /^tools\//, /^lib\/pdfjs\//, /^tour\//, /^tour\.html$/, /\.md$/, /^render\.yaml$/,
  /^(pdfreader|pptxreader|docxreader)\.html$/, /^readers\/(pdf|pptx|docx)reader/, /^readers\/(pptx|docx)-parse\.js$/, /^readers\/ooxml-drawing\.js$/];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const files = {};
const put = (rel, content) => {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  if (rel !== "index.html") files[rel] = dest;
};

const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
for (const rel of tracked) {
  if (SKIP.some((re) => re.test(rel))) continue;
  let buf = fs.readFileSync(path.join(ROOT, rel));
  // Every extension page loads the stand-in first.
  if (rel.endsWith(".html")) {
    buf = buf.toString("utf8").replace(/<head>/i, '<head>\n<script src="bench/shim.js"></script>');
  }
  put(rel, buf);
}

const manifest = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
put("bench/shim.js", fs.readFileSync(path.join(BENCH, "shim.js"), "utf8").replace("__MANIFEST__", manifest.trim()));
put("bench/bg-start.js", fs.readFileSync(path.join(BENCH, "bg-start.js")));
put("bg.html", fs.readFileSync(path.join(BENCH, "bg.html")));
put("article.html", fs.readFileSync(path.join(BENCH, "article.html")));
put("index.html", fs.readFileSync(path.join(BENCH, "shell.html")));
fs.writeFileSync(path.join(OUT, "files.json"), JSON.stringify(files, null, 1));
console.log(`Test bench: ${Object.keys(files).length + 1} files in ${OUT}`);

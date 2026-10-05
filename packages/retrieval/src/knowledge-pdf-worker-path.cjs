// Native resolution avoids bundler rewriting of __dirname or require.resolve.
const path = require("node:path");
const nativeRequire = require("node:module").createRequire(path.join(process.cwd(), "package.json"));
exports.knowledgePdfWorkerPath = nativeRequire.resolve("@deliberation-ai/retrieval/knowledge-pdf-worker", {
  paths: [process.cwd(), path.resolve(process.cwd(), "apps/web"), __dirname],
});

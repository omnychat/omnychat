#!/usr/bin/env node
/**
 * Generate TypeScript protobuf stubs into packages/client/src/proto.
 * Uses the repo-root proto schema and @bufbuild/protoc-gen-es.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsRoot = resolve(__dirname, "..");
const repoRoot = resolve(tsRoot, "../..");
const outDir = join(tsRoot, "packages/client/src/proto");
const protoFile = join(repoRoot, "proto/omnychat/v1/omnychat.proto");
const protoPath = join(repoRoot, "proto");

mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
const pluginPath = require.resolve("@bufbuild/protoc-gen-es/bin/protoc-gen-es");

const candidates = [
  process.env.PROTOC,
  join(repoRoot, ".tools/protoc/bin/protoc"),
  "protoc",
].filter(Boolean);

let protoc = null;
for (const c of candidates) {
  if (c === "protoc" || existsSync(c)) {
    protoc = c;
    break;
  }
}

if (!protoc) {
  console.error("protoc not found; set PROTOC or install .tools/protoc");
  process.exit(1);
}

const args = [
  `-I${protoPath}`,
  `--plugin=protoc-gen-es=${pluginPath}`,
  `--es_out=${outDir}`,
  `--es_opt=target=ts`,
  protoFile,
];

console.log(`Running: ${protoc} ${args.join(" ")}`);
const result = spawnSync(protoc, args, { stdio: "inherit" });
process.exit(result.status ?? 1);

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".gz",
  ".tar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

const report = [];

function main() {
  const packageJson = readJson("package.json");
  const versionManifest = readJson("version-manifest.json");
  const releaseTag = `v${packageJson.version}`;

  assert(
    packageJson.version === versionManifest.appVersion,
    `version-manifest.json appVersion must match package.json version (${packageJson.version})`,
  );

  assertFileExists("docs/releases/v0.1.2/规划需求.md");
  assertFileExists("docs/releases/v0.1.3/规划需求.md");
  assertFileExists("docs/releases/v0.1.4/规划需求.md");

  assertFileExists("src-tauri/icons/app-icon-source.png");
  assertFileExists("src-tauri/icons/icon.png");
  assertFileExists("src-tauri/icons/icon.ico");
  assertFileExists("src-tauri/icons/icon.icns");
  assertFileExists("src-tauri/icons/32x32.png");
  assertFileExists("src-tauri/icons/128x128.png");

  const readme = readText("README.md");
  assertIncludes(
    readme,
    `pnpm version:check -- --tag ${releaseTag}`,
    `README.md must document the current release tag ${releaseTag}`,
  );
  assertIncludes(
    readme,
    "pnpm repo:check",
    "README.md must document the repo hygiene gate",
  );
  assertIncludes(
    readme,
    "pnpm pressure:test",
    "README.md must document the pressure-test gate",
  );
  assertIncludes(
    readme,
    "_portable",
    "README.md must document the portable release asset naming rule",
  );

  const releaseDocsIndex = readText("docs/releases/README.md");
  assertIncludes(
    releaseDocsIndex,
    releaseTag,
    "docs/releases/README.md must reference the current release tag",
  );

  const releasePlan = readText(`docs/releases/${releaseTag}/规划需求.md`);
  assertIncludes(
    releasePlan,
    `版本号：\`${releaseTag}\``,
    "The active release plan must declare the current release tag",
  );

  const workflow = readText(".github/workflows/release.yml");
  assertIncludes(
    workflow,
    'pnpm version:check -- --tag "${{ github.ref_name }}"',
    "Release workflow must gate on version sync",
  );
  assertIncludes(
    workflow,
    "pnpm repo:check",
    "Release workflow must run repo hygiene checks",
  );
  assertIncludes(
    workflow,
    "pnpm pressure:test",
    "Release workflow must run the pressure-test gate",
  );
  assertIncludes(
    workflow,
    'releaseAssetNamePattern: "[name]_[version]_[platform]_[arch]_[setup][ext]"',
    "Release workflow must keep the standard bundle naming rule",
  );
  assertIncludes(
    workflow,
    'releaseAssetNamePattern: "[name]_[version]_[platform]_[arch]_portable[ext]"',
    "Release workflow must publish the portable asset naming rule",
  );

  scanTrackedTextFiles();

  process.stdout.write(`${report.join("\n")}\n`);
}

function scanTrackedTextFiles() {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  const forbiddenPatterns = [
    {
      label: "macOS absolute user path",
      pattern: /\/Users\/[^/\s]+\/(?:Code|Desktop|Documents|Downloads|Projects|Workspace|Repos|work|repo)?/g,
    },
    {
      label: "Linux absolute user path",
      pattern: /\/home\/[^/\s]+\//g,
    },
    {
      label: "Windows absolute user path",
      pattern: /[A-Za-z]:\\Users\\[^\\\s]+\\/g,
    },
    {
      label: "file URI",
      pattern: /file:\/\//g,
    },
    {
      label: "stale release tag link",
      pattern: /(?:releases\/tag|archive\/refs\/tags)\/v0\.1\.(?:5|[5-9]\d*)\b/g,
    },
  ];

  for (const relativePath of trackedFiles) {
    if (binaryExtensions.has(extname(relativePath).toLowerCase())) {
      continue;
    }

    const absolutePath = resolve(repoRoot, relativePath);
    const content = readMaybeText(absolutePath, relativePath);
    if (content == null) {
      continue;
    }

    for (const { label, pattern } of forbiddenPatterns) {
      const match = content.match(pattern);
      if (match) {
        throw new Error(
          `${relativePath} contains forbidden ${label}: ${match[0]}`,
        );
      }
    }
  }

  report.push(`Tracked text files scanned: ${trackedFiles.length}`);
}

function readMaybeText(path, relativePath) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    // File is tracked by git but missing from working tree (e.g. staged deletion).
    // Skip it rather than crashing the hygiene gate.
    return null;
  }
  if (buffer.includes(0)) {
    return null;
  }

  const content = buffer.toString("utf8");
  if (content.includes("\uFFFD") && !isLikelyTextFile(relativePath)) {
    return null;
  }
  return content;
}

function isLikelyTextFile(relativePath) {
  const extension = extname(relativePath).toLowerCase();
  if (extension) {
    return true;
  }

  const name = basename(relativePath);
  return [
    "README",
    "README.md",
    "LICENSE",
    ".gitignore",
    ".npmrc",
    ".editorconfig",
  ].includes(name);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function assertFileExists(relativePath) {
  assert(existsSync(resolve(repoRoot, relativePath)), `Missing required file: ${relativePath}`);
  report.push(`OK: required file present: ${relativePath}`);
}

function assertMissing(relativePath) {
  assert(!existsSync(resolve(repoRoot, relativePath)), `File must be absent: ${relativePath}`);
  report.push(`OK: file absent as expected: ${relativePath}`);
}

function assertIncludes(content, needle, message) {
  assert(content.includes(needle), message);
  report.push(`OK: ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

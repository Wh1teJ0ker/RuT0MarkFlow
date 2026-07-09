#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function main() {
  const packageJson = JSON.parse(
    await readFile(resolve(repoRoot, "package.json"), "utf8"),
  );
  const cargoToml = await readFile(
    resolve(repoRoot, "src-tauri/Cargo.toml"),
    "utf8",
  );
  const tauriConfig = JSON.parse(
    await readFile(resolve(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const versionManifest = JSON.parse(
    await readFile(resolve(repoRoot, "version-manifest.json"), "utf8"),
  );
  const versionModule = await readFile(resolve(repoRoot, "src/version.ts"), "utf8");

  const packageVersion = packageJson.version;
  const cargoVersion = readCargoPackageVersion(cargoToml);
  const tauriVersion = tauriConfig.version;
  const appVersion = versionManifest.appVersion;
  const frontendVersion = versionManifest.frontendVersion;
  const backendVersion = versionManifest.backendVersion;
  const workspaceSchemaVersion = versionManifest.workspaceSchemaVersion;
  const fallbackVersions = readVersionModuleFallbacks(versionModule);
  const expectedTag = `v${packageVersion}`;
  const tag = readTagArg(process.argv.slice(2));

  assertSemver(packageVersion, "package.json");
  assertSemver(cargoVersion, "src-tauri/Cargo.toml");
  assertSemver(tauriVersion, "src-tauri/tauri.conf.json");
  assertSemver(appVersion, "version-manifest.json appVersion");
  assertSemver(frontendVersion, "version-manifest.json frontendVersion");
  assertSemver(backendVersion, "version-manifest.json backendVersion");
  assertSemver(
    workspaceSchemaVersion,
    "version-manifest.json workspaceSchemaVersion",
  );
  assertSemver(
    fallbackVersions.releaseVersion,
    "src/version.ts FALLBACK_RELEASE_VERSION",
  );
  assertSemver(
    fallbackVersions.workspaceSchemaVersion,
    "src/version.ts FALLBACK_WORKSPACE_SCHEMA_VERSION",
  );

  const versions = [
    ["package.json", packageVersion],
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/tauri.conf.json", tauriVersion],
    ["version-manifest.json appVersion", appVersion],
    ["version-manifest.json frontendVersion", frontendVersion],
    ["version-manifest.json backendVersion", backendVersion],
    ["src/version.ts FALLBACK_RELEASE_VERSION", fallbackVersions.releaseVersion],
  ];

  const uniqueVersions = new Set(versions.map(([, version]) => version));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `Version mismatch detected: ${versions
        .map(([file, version]) => `${file}=${version}`)
        .join(", ")}`,
    );
  }

  if (workspaceSchemaVersion !== fallbackVersions.workspaceSchemaVersion) {
    throw new Error(
      `Workspace schema mismatch detected: version-manifest.json workspaceSchemaVersion=${workspaceSchemaVersion}, src/version.ts FALLBACK_WORKSPACE_SCHEMA_VERSION=${fallbackVersions.workspaceSchemaVersion}`,
    );
  }

  if (tag && tag !== expectedTag) {
    throw new Error(`Git tag ${tag} does not match expected ${expectedTag}`);
  }

  process.stdout.write(
    [
      `Version check passed: ${packageVersion}`,
      `Expected release tag: ${expectedTag}`,
      `Component versions: frontend=${frontendVersion}, backend=${backendVersion}, workspaceSchema=${workspaceSchemaVersion}`,
      tag ? `Validated tag: ${tag}` : "Validated tag: <not provided>",
    ].join("\n") + "\n",
  );
}

function readCargoPackageVersion(content) {
  const match = content.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Unable to read package version from src-tauri/Cargo.toml");
  }
  return match[1];
}

function assertSemver(version, file) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`${file} has invalid semver version: ${String(version)}`);
  }
}

function readVersionModuleFallbacks(content) {
  const releaseVersion = readConst(
    content,
    "FALLBACK_RELEASE_VERSION",
    "src/version.ts",
  );
  const workspaceSchemaVersion = readConst(
    content,
    "FALLBACK_WORKSPACE_SCHEMA_VERSION",
    "src/version.ts",
  );

  return {
    releaseVersion,
    workspaceSchemaVersion,
  };
}

function readConst(content, name, file) {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*"([^"]+)"`);
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Unable to read ${name} from ${file}`);
  }
  return match[1];
}

function readTagArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") {
      if (!argv[index + 1]) {
        throw new Error("Missing value for --tag");
      }
      return argv[index + 1];
    }
  }
  return null;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

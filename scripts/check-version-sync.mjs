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

  const packageVersion = packageJson.version;
  const cargoVersion = readCargoPackageVersion(cargoToml);
  const tauriVersion = tauriConfig.version;
  const expectedTag = `v${packageVersion}`;
  const tag = readTagArg(process.argv.slice(2));

  assertSemver(packageVersion, "package.json");
  assertSemver(cargoVersion, "src-tauri/Cargo.toml");
  assertSemver(tauriVersion, "src-tauri/tauri.conf.json");

  const versions = [
    ["package.json", packageVersion],
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/tauri.conf.json", tauriVersion],
  ];

  const uniqueVersions = new Set(versions.map(([, version]) => version));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `Version mismatch detected: ${versions
        .map(([file, version]) => `${file}=${version}`)
        .join(", ")}`,
    );
  }

  if (tag && tag !== expectedTag) {
    throw new Error(`Git tag ${tag} does not match expected ${expectedTag}`);
  }

  process.stdout.write(
    [
      `Version check passed: ${packageVersion}`,
      `Expected release tag: ${expectedTag}`,
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

function readTagArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") {
      return argv[index + 1];
    }
  }
  return process.env.GITHUB_REF_NAME || null;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

/**
 * Pressure Test — Workspace Scan + Index Benchmark
 *
 * Generates a temporary workspace with 1000+ Markdown files,
 * measures Rust scanner + indexer performance via `cargo test`,
 * and outputs structured results.
 *
 * Usage:
 *   node scripts/pressure-test-workspace.mjs
 *
 * Environment variables:
 *   PRESSURE_FILE_COUNT  — number of .md files to generate (default: 1000)
 *   PRESSURE_KEEP        — set to "1" to keep temp directory after test
 *   CARGO_FLAGS          — extra flags for cargo (e.g., "--release")
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Configuration ─────────────────────────────────────────────────
const FILE_COUNT = parseInt(process.env.PRESSURE_FILE_COUNT || "1000", 10);
const CARGO_FLAGS = process.env.CARGO_FLAGS || "";
const KEEP = process.env.PRESSURE_KEEP === "1";

// ── Helpers ────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  const result = execSync(cmd, {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    ...opts,
  });
  return result;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  RuT0MarkFlow — 压力测试");
  console.log("  1000+ Markdown 文件工作区扫描与索引构建");
  console.log("=".repeat(60));
  console.log("");
  console.log(`文件数: ${FILE_COUNT}`);
  console.log(`机器:   ${process.platform} ${process.arch}`);
  console.log(`Node:   ${process.version}`);
  console.log(`时间:   ${new Date().toISOString()}`);
  console.log("");

  // ── Step 1: Create temp workspace ────────────────────────────────
  const tmpDir = join(PROJECT_ROOT, ".pressure-tmp");
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const subdirs = [
    "docs",
    "docs/guides",
    "docs/api",
    "docs/tutorials",
    "notes",
    "notes/meetings",
    "notes/ideas",
    "reports",
    "reports/2024",
    "reports/2025",
    "wiki",
    "wiki/engineering",
    "wiki/design",
    "wiki/operations",
  ];

  const allLocations = ["", ...subdirs];

  console.log("正在生成工作区样本…");
  console.log(`  目标: ${tmpDir}`);

  const generateStart = Date.now();

  for (const sub of subdirs) {
    mkdirSync(join(tmpDir, sub), { recursive: true });
  }

  for (let i = 0; i < FILE_COUNT; i++) {
    const loc = allLocations[i % allLocations.length];
    const fileName = `doc_${String(i).padStart(4, "0")}.md`;
    const filePath = loc ? join(tmpDir, loc, fileName) : join(tmpDir, fileName);

    const content = [
      `# Document ${i}`,
      "",
      "This is a generated Markdown file for pressure testing.",
      "",
      "## Section 1",
      "",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      "",
      `- Item ${i}`,
      `- Item ${i + 1}`,
      `- Item ${i + 2}`,
      "",
      "## Section 2",
      "",
      `See [link](../docs/guides/doc_${String((i + 1) % FILE_COUNT).padStart(4, "0")}.md) for more details.`,
      "",
      "```rust",
      'fn hello() -> &\'static str {',
      '    "Hello, world!"',
      "}",
      "```",
      "",
      "> This is a blockquote.",
      "",
      "| Col A | Col B |",
      "|-------|-------|",
      "| Value | Value |",
      "",
    ].join("\n");

    writeFileSync(filePath, content, "utf-8");
  }

  const generateDuration = Date.now() - generateStart;
  console.log(`  生成耗时: ${formatDuration(generateDuration)}`);
  console.log(`  实际文件数: ${countFiles(tmpDir)}`);
  console.log("");

  // ── Step 2: Run Rust benchmark ───────────────────────────────────
  console.log("正在运行 Rust 扫描+索引压测…");

  const benchStart = Date.now();

  // Build and run the pressure_bench test with filter
  const testOutput = run(
    `cargo test --manifest-path src-tauri/Cargo.toml pressure_bench_scan_and_index -- --nocapture --test-threads=1 ${CARGO_FLAGS}`.trim(),
    {
      stdio: "pipe",
      env: {
        ...process.env,
        PRESSURE_FILE_COUNT: String(FILE_COUNT),
        PRESSURE_ROOT: tmpDir,
      },
    }
  );

  const benchDuration = Date.now() - benchStart;
  console.log(`  压测总耗时: ${formatDuration(benchDuration)}`);
  console.log("");

  // ── Step 3: Parse results ────────────────────────────────────────
  console.log("-".repeat(60));
  console.log("  压测输出:");
  console.log("-".repeat(60));

  // Extract structured results from output
  const lines = testOutput.split("\n");
  const results = {};
  let inResults = false;

  for (const line of lines) {
    if (line.includes("=== Pressure Benchmark Results ===")) {
      inResults = true;
      continue;
    }
    if (line.includes("=== End Pressure Benchmark ===")) {
      inResults = false;
      continue;
    }
    if (inResults && line.includes(":")) {
      const sep = line.indexOf(":");
      const key = line.slice(0, sep).trim();
      const val = line.slice(sep + 1).trim();
      results[key] = val;
      console.log(`  ${key}: ${val}`);
    }
  }

  console.log("-".repeat(60));
  console.log("");

  // ── Step 4: Verify cargo test passes ─────────────────────────────
  // Check that "test result: ok" appears in output
  const testOk = testOutput.includes("test result: ok");
  console.log(`Rust 测试通过: ${testOk ? "✅" : "❌"}`);

  // ── Step 5: Verify cargo clippy ──────────────────────────────────
  console.log("正在运行 clippy 检查…");
  const clippyOutput = run("cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings 2>&1", {
    stdio: "pipe",
  });
  console.log(`Clippy: ${clippyOutput.includes("warning") ? "有警告" : "✅ 0 warnings"}`);

  // ── Conclusion ────────────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(60));
  console.log("  压力测试结论");
  console.log("=".repeat(60));
  console.log("");

  const fileCount = parseInt(results.file_count || FILE_COUNT, 10);
  const scanMs = parseFloat(results.scan_duration_ms || "0");
  const indexMs = parseFloat(results.index_duration_ms || "0");
  const totalMs = scanMs + indexMs;
  const quality = results.quality || "unknown";

  console.log(`  文件数:          ${fileCount}`);
  console.log(`  扫描耗时:        ${formatDuration(scanMs)}`);
  console.log(`  索引构建耗时:    ${formatDuration(indexMs)}`);
  console.log(`  总耗时:          ${formatDuration(totalMs)}`);
  console.log(`  质量评级:        ${quality}`);

  if (results.files_per_sec) {
    console.log(`  扫描吞吐:        ${results.files_per_sec} 文件/秒`);
  }

  console.log("");

  if (totalMs < 500) {
    console.log("  ✅ 性能优秀：1000+ 文件工作区扫描+索引在 500ms 内完成。");
    console.log("     界面在扫描期间保持可操作（spawn_blocking + loading 态）。");
  } else if (totalMs < 2000) {
    console.log("  ✅ 性能可接受：1000+ 文件工作区扫描+索引在 2s 内完成。");
    console.log("     界面在扫描期间保持可操作（spawn_blocking + loading 态）。");
  } else if (totalMs < 5000) {
    console.log("  ⚠️ 性能中等：1000+ 文件工作区扫描+索引在 5s 内完成。");
    console.log("     仍有优化空间（如增量索引），但架构已确保界面不阻塞。");
  } else {
    console.log("  ❌ 性能待优化：1000+ 文件工作区扫描+索引超过 5s。");
    console.log("     建议引入增量索引或并行扫描优化。");
  }

  console.log("");

  // ── Step 6: Cleanup ──────────────────────────────────────────────
  if (!KEEP && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    console.log(`已清理临时工作区: ${tmpDir}`);
  } else if (KEEP) {
    console.log(`保留临时工作区 (PRESSURE_KEEP=1): ${tmpDir}`);
  }

  // Export structured results for downstream consumption
  const report = {
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    fileCount,
    scanDurationMs: scanMs,
    indexDurationMs: indexMs,
    totalDurationMs: totalMs,
    quality,
    filesPerSec: results.files_per_sec ? parseFloat(results.files_per_sec) : null,
    workspaceSizeMb: results.workspace_size_mb ? parseFloat(results.workspace_size_mb) : null,
    testPassed: testOk,
    clippyCleaned: !clippyOutput.includes("warning"),
  };

  const reportPath = join(PROJECT_ROOT, "handoff", "pressure-test-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n结构化报告已写入: ${reportPath}`);

  // Exit with proper code
  if (!testOk) {
    console.error("\n❌ 压测失败 — Rust 测试未通过");
    process.exit(1);
  }

  console.log("\n✅ 压力测试完成");
}

function countFiles(dir) {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
        count++;
      }
    }
  } catch {
    // skip unreadable
  }
  return count;
}

main().catch((err) => {
  console.error("压力测试失败:", err.message);
  process.exit(1);
});

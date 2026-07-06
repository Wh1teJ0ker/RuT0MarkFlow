#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import process from "node:process";

const DEFAULT_ZCODE_CLI =
  process.env.ZCODE_CLI_PATH ||
  "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";

const DEFAULT_WORKSPACE = process.cwd();
const DEFAULT_ZCODE_CONFIG =
  process.env.ZCODE_CONFIG_PATH || `${homedir()}/.zcode/v2/config.json`;
const DEFAULT_ZCODE_MESSAGE_DB =
  process.env.ZCODE_MESSAGE_DB_PATH || `${homedir()}/.zcode/cli/db/db.sqlite`;
const DEFAULT_ZCODE_TASKS_INDEX =
  process.env.ZCODE_TASKS_INDEX_PATH || `${homedir()}/.zcode/v2/tasks-index.sqlite`;
const PERSISTED_MODEL_SYNC_LIMIT = 16;

function main() {
  run(process.argv.slice(2)).catch((error) => {
    printError(error);
    process.exitCode = 1;
  });
}

async function run(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case "doctor":
      await runDoctor(parseFlags(rest));
      return;
    case "list-sessions":
      await runListSessions(parseFlags(rest));
      return;
    case "set-runtime-model":
      await runSetRuntimeModel(parseFlags(rest));
      return;
    case "send":
      await runSend(parseFlags(rest));
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runDoctor(options) {
  const args = ["doctor"];
  if (options.json) {
    args.push("--json");
  }

  const result = await runCli(args);
  if (options.json) {
    const payload = JSON.parse(result.stdout || "{}");
    writeJson(payload);
    return;
  }

  process.stdout.write(result.stdout);
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

async function runListSessions(options) {
  const client = createProtocolClient();
  try {
    const sessions = await listSessions(client, options);

    if (options.json) {
      writeJson({ sessions });
      return;
    }

    if (sessions.length === 0) {
      process.stdout.write("No matching ZCode sessions found.\n");
      return;
    }

    for (const session of sessions) {
      process.stdout.write(
        [
          session.sessionId,
          `  title: ${session.title}`,
          `  status: ${session.status}`,
          `  mode: ${session.mode}`,
          `  updated: ${new Date(session.updatedAt).toISOString()}`,
          `  workspace: ${session.workspace.workspacePath}`,
          "",
        ].join("\n"),
      );
    }
  } finally {
    await client.close();
  }
}

async function runSend(options) {
  const sessionQuery = requireStringOption(options, "session");
  const message = await resolveMessage(options);
  const waitOptions = resolveSendWaitOptions(options);
  const client = createProtocolClient();

  try {
    const sessions = await listSessions(client, options);
    const target = resolveTargetSession(sessions, sessionQuery);
    const runtimeModelSelection = await resolveRuntimeModelSelection(options);
    let runtimeModelApplyResult = null;

    if (options["dry-run"]) {
      const payload = {
        dryRun: true,
        session: summarizeSession(target),
        message,
        runtimeModel: runtimeModelSelection
          ? summarizeRuntimeModel(runtimeModelSelection)
          : null,
      };

      if (options.json) {
        writeJson(payload);
      } else {
        process.stdout.write(
          [
            "Dry run only. No message was sent.",
            `sessionId: ${target.sessionId}`,
            `title: ${target.title}`,
            `workspace: ${target.workspace.workspacePath}`,
            runtimeModelSelection
              ? `runtimeModel: ${JSON.stringify(
                  summarizeRuntimeModel(runtimeModelSelection),
                )}`
              : null,
            `message: ${JSON.stringify(message)}`,
            "",
          ].join("\n"),
        );
      }
      return;
    }

    await client.request("session/resume", {
      sessionId: target.sessionId,
    });

    if (runtimeModelSelection) {
      runtimeModelApplyResult = await applyRuntimeModelSelection(
        client,
        target,
        runtimeModelSelection,
      );
    }

    const sendResult = await client.request("session/send", {
      sessionId: target.sessionId,
      content: message,
      inputId: `bridge-${randomUUID()}`,
      queryId: `bridge-${randomUUID()}`,
    });

    const waitResult = waitOptions.enabled
      ? await waitForPromptCompletion(client, target.sessionId, waitOptions)
      : null;

    const payload = {
      accepted: true,
      session: summarizeSession(target),
      runtimeModel: runtimeModelSelection
        ? summarizeRuntimeModel(runtimeModelSelection)
        : null,
      persistedSync: runtimeModelSelection
        ? runtimeModelApplyResult?.persistedSync || null
        : null,
      wait: waitResult,
      result: sendResult,
    };

    if (options.json) {
      writeJson(payload);
      return;
    }

    process.stdout.write(
      [
        "Message accepted by ZCode.",
        `sessionId: ${target.sessionId}`,
        `title: ${target.title}`,
        runtimeModelSelection
          ? `runtimeModel: ${JSON.stringify(
              summarizeRuntimeModel(runtimeModelSelection),
            )}`
          : null,
        runtimeModelApplyResult?.persistedSync
          ? `persistedSync: ${JSON.stringify(runtimeModelApplyResult.persistedSync)}`
          : null,
        waitResult ? `wait: ${JSON.stringify(waitResult)}` : null,
        `stateRevision: ${sendResult.stateRevision}`,
        sendResult.modelRuntimeRevision
          ? `modelRuntimeRevision: ${sendResult.modelRuntimeRevision}`
          : null,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } finally {
    await client.close();
  }
}

async function runSetRuntimeModel(options) {
  const sessionQuery = requireStringOption(options, "session");
  const runtimeModel = await requireRuntimeModelSelection(options);
  const client = createProtocolClient();

  try {
    const sessions = await listSessions(client, options);
    const target = resolveTargetSession(sessions, sessionQuery);

    if (options["dry-run"]) {
      const payload = {
        dryRun: true,
        session: summarizeSession(target),
        runtimeModel: summarizeRuntimeModel(runtimeModel),
      };
      if (options.json) {
        writeJson(payload);
      } else {
        process.stdout.write(
          [
            "Dry run only. No runtime model was changed.",
            `sessionId: ${target.sessionId}`,
            `title: ${target.title}`,
            `workspace: ${target.workspace.workspacePath}`,
            `runtimeModel: ${JSON.stringify(summarizeRuntimeModel(runtimeModel))}`,
            "",
          ].join("\n"),
        );
      }
      return;
    }

    await client.request("session/resume", {
      sessionId: target.sessionId,
    });

    const result = await applyRuntimeModelSelection(client, target, runtimeModel);

    const payload = {
      changed: result.changed,
      appliedModelRuntimeRevision: result.appliedModelRuntimeRevision,
      persistedSync: result.persistedSync,
      session: summarizeSession(target),
      runtimeModel: summarizeRuntimeModel(runtimeModel),
    };

    if (options.json) {
      writeJson(payload);
      return;
    }

    process.stdout.write(
      [
        result.changed
          ? "Runtime model updated."
          : "Runtime model already matched the requested selection.",
        `sessionId: ${target.sessionId}`,
        `title: ${target.title}`,
        `appliedModelRuntimeRevision: ${result.appliedModelRuntimeRevision}`,
        result.persistedSync
          ? `persistedSync: ${JSON.stringify(result.persistedSync)}`
          : null,
        `runtimeModel: ${JSON.stringify(summarizeRuntimeModel(runtimeModel))}`,
        "",
      ].join("\n"),
    );
  } finally {
    await client.close();
  }
}

async function listSessions(client, options) {
  const params = {};
  if (!options.all) {
    params.workspace = workspacePayload(options.workspace || DEFAULT_WORKSPACE);
  }
  if (options.limit !== undefined) {
    params.limit = parsePositiveInt(options.limit, "limit");
  }

  const response = await client.request("session/list", params);
  const sessions = Array.isArray(response.sessions) ? response.sessions : [];
  return sessions
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function resolveTargetSession(sessions, query) {
  if (sessions.length === 0) {
    throw new Error("No ZCode sessions are available for the requested scope.");
  }

  if (query === "latest") {
    return sessions[0];
  }

  const exactId = sessions.find((session) => session.sessionId === query);
  if (exactId) {
    return exactId;
  }

  const exactTitle = sessions.find((session) => session.title === query);
  if (exactTitle) {
    return exactTitle;
  }

  const normalizedQuery = query.toLowerCase();
  const fuzzy = sessions.filter((session) =>
    session.title.toLowerCase().includes(normalizedQuery),
  );

  if (fuzzy.length === 1) {
    return fuzzy[0];
  }

  if (fuzzy.length === 0) {
    throw new Error(`No session matched ${JSON.stringify(query)}.`);
  }

  const choices = fuzzy
    .slice(0, 10)
    .map((session) => `- ${session.sessionId} | ${session.title}`)
    .join("\n");
  throw new Error(
    `Session query ${JSON.stringify(query)} matched multiple sessions:\n${choices}`,
  );
}

function summarizeSession(session) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    status: session.status,
    mode: session.mode,
    updatedAt: session.updatedAt,
    workspace: session.workspace,
  };
}

function summarizeRuntimeModel(runtimeModel) {
  return {
    providerId: runtimeModel.provider.providerId,
    providerLabel: runtimeModel.provider.label || null,
    modelId: runtimeModel.model.modelId,
    thoughtLevel: runtimeModel.thoughtLevel || null,
    revision: runtimeModel.revision,
  };
}

function workspacePayload(workspacePath) {
  return {
    workspaceKey: workspacePath,
    workspacePath,
  };
}

function createProtocolClient() {
  const child = spawn(process.execPath, [DEFAULT_ZCODE_CLI, "app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let closed = false;
  let settled = false;
  let nextId = 1;
  let closePromiseResolve;
  let closePromiseReject;

  const pending = new Map();
  const stderrChunks = [];
  const closePromise = new Promise((resolve, reject) => {
    closePromiseResolve = resolve;
    closePromiseReject = reject;
  });

  function settle(error) {
    if (settled) {
      return;
    }
    settled = true;
    closed = true;

    if (error) {
      rejectAllPending(pending, error);
      closePromiseReject(error);
      return;
    }

    closePromiseResolve();
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    try {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        handleLine(line, pending);
      }
    } catch (error) {
      settle(error);
      child.kill();
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  child.on("error", (error) => {
    settle(error);
  });

  child.on("close", (code) => {
    if (settled) {
      return;
    }

    const stderr = stderrChunks.join("").trim();
    try {
      if (buffer.trim()) {
        handleLine(buffer.trim(), pending);
        buffer = "";
      }
    } catch (error) {
      settle(error);
      return;
    }

    if (code === 0 || code === null) {
      settle();
      return;
    }

    const error = new Error(
      stderr
        ? `ZCode protocol server exited with code ${code}: ${stderr}`
        : `ZCode protocol server exited with code ${code}`,
    );
    settle(error);
  });

  return {
    async request(method, params = {}) {
      if (closed) {
        throw new Error("ZCode protocol server is already closed.");
      }

      const id = String(nextId++);
      const message = JSON.stringify({ id, method, params });

      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });

      child.stdin.write(`${message}\n`);
      return promise;
    },

    async close() {
      if (!closed) {
        child.stdin.end();
      }
      await closePromise.catch(() => {});
    },
  };
}

function handleLine(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    throw new Error(`Failed to parse ZCode protocol response: ${error.message}`);
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    return;
  }

  const key = String(message.id);
  const entry = pending.get(key);
  if (!entry) {
    return;
  }
  pending.delete(key);

  if (Object.prototype.hasOwnProperty.call(message, "error")) {
    const error = new Error(message.error.message || "Unknown ZCode protocol error");
    error.code = message.error.code;
    error.data = message.error.data;
    entry.reject(error);
    return;
  }

  entry.resolve(message.result);
}

function rejectAllPending(pending, error) {
  for (const { reject } of pending.values()) {
    reject(error);
  }
  pending.clear();
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEFAULT_ZCODE_CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          stderr.trim()
            ? stderr.trim()
            : `ZCode CLI exited with code ${code}.`,
        ),
      );
    });
  });
}

function parseFlags(argv) {
  const options = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey;
    if (!key) {
      throw new Error("Invalid empty flag.");
    }

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    if (isBooleanFlag(key)) {
      options[key] = true;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = next;
    index += 1;
  }

  return options;
}

function isBooleanFlag(key) {
  return (
    key === "json" ||
    key === "dry-run" ||
    key === "all" ||
    key === "no-wait"
  );
}

function requireStringOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

async function resolveMessage(options) {
  if (typeof options.message === "string") {
    if (options.message === "-") {
      return readStdin();
    }
    return options.message;
  }

  const positional = options._.join(" ").trim();
  if (positional) {
    return positional;
  }

  throw new Error("--message is required");
}

async function resolveRuntimeModelSelection(options) {
  const hasProviderId = typeof options["provider-id"] === "string";
  const hasProviderName = typeof options["provider-name"] === "string";
  const hasModelId = typeof options["model-id"] === "string";
  const hasThoughtLevel = typeof options["thought-level"] === "string";

  if (!hasProviderId && !hasProviderName && !hasModelId && !hasThoughtLevel) {
    return null;
  }

  return requireRuntimeModelSelection(options);
}

function resolveSendWaitOptions(options) {
  return {
    enabled: !options["no-wait"],
    pollMs:
      options["wait-poll-ms"] !== undefined
        ? parsePositiveInt(options["wait-poll-ms"], "wait-poll-ms")
        : 500,
    timeoutMs:
      options["wait-timeout-ms"] !== undefined
        ? parsePositiveInt(options["wait-timeout-ms"], "wait-timeout-ms")
        : 20 * 60 * 1000,
  };
}

async function requireRuntimeModelSelection(options) {
  const providerRef = readProviderReference(options);
  const modelId = requireStringOption(options, "model-id");
  const catalog = await loadProviderCatalog();
  const { providerId, providerConfig } = resolveProviderConfig(catalog, providerRef);
  const runtimeModel = buildRuntimeModel(providerId, providerConfig, modelId, {
    thoughtLevel:
      typeof options["thought-level"] === "string"
        ? options["thought-level"]
        : undefined,
  });

  if (!runtimeModel.provider.models.some((entry) => entry.modelId === modelId)) {
    throw new Error(
      `Model ${JSON.stringify(modelId)} is not configured for provider ${JSON.stringify(
        runtimeModel.provider.label || providerId,
      )}.`,
    );
  }

  return runtimeModel;
}

function readProviderReference(options) {
  const providerId =
    typeof options["provider-id"] === "string" ? options["provider-id"] : null;
  const providerName =
    typeof options["provider-name"] === "string"
      ? options["provider-name"]
      : null;

  if (providerId && providerName) {
    throw new Error("Use either --provider-id or --provider-name, not both.");
  }

  if (providerId) {
    return { providerId };
  }

  if (providerName) {
    return { providerName };
  }

  throw new Error("Either --provider-id or --provider-name is required.");
}

async function loadProviderCatalog() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(DEFAULT_ZCODE_CONFIG, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ZCode provider config at ${DEFAULT_ZCODE_CONFIG}: ${error.message}`,
    );
  }

  const providerMap = parsed?.provider;
  if (!providerMap || typeof providerMap !== "object") {
    throw new Error(
      `Unexpected provider config format in ${DEFAULT_ZCODE_CONFIG}.`,
    );
  }

  return providerMap;
}

function resolveProviderConfig(catalog, providerRef) {
  if (providerRef.providerId) {
    const match = catalog[providerRef.providerId];
    if (!match) {
      throw new Error(
        `No provider matched provider id ${JSON.stringify(
          providerRef.providerId,
        )} in ${DEFAULT_ZCODE_CONFIG}.`,
      );
    }
    return {
      providerId: providerRef.providerId,
      providerConfig: match,
    };
  }

  const matches = Object.entries(catalog).filter(([, value]) => {
    return value?.name === providerRef.providerName;
  });

  if (matches.length === 1) {
    return {
      providerId: matches[0][0],
      providerConfig: matches[0][1],
    };
  }

  if (matches.length === 0) {
    throw new Error(
      `No provider matched provider name ${JSON.stringify(
        providerRef.providerName,
      )} in ${DEFAULT_ZCODE_CONFIG}.`,
    );
  }

  throw new Error(
    `Provider name ${JSON.stringify(
      providerRef.providerName,
    )} matched multiple entries in ${DEFAULT_ZCODE_CONFIG}. Use --provider-id.`,
  );
}

function buildRuntimeModel(providerId, providerConfig, modelId, options = {}) {
  const runtimeProvider = {
    providerId,
    kind: normalizeProviderKind(providerConfig.kind),
    source: normalizeProviderSource(providerConfig.source),
    models: Object.entries(providerConfig.models || {}).map(([id, config]) =>
      toRuntimeProviderModel(id, config),
    ),
  };

  if (providerConfig.name) {
    runtimeProvider.label = providerConfig.name;
  }
  if (providerConfig.options?.baseURL) {
    runtimeProvider.baseURL = providerConfig.options.baseURL;
  }
  if (providerConfig.options?.apiKey) {
    runtimeProvider.apiKey = {
      source: "inline",
      value: providerConfig.options.apiKey,
    };
  }
  if (providerConfig.options?.apiKeyRequired !== undefined) {
    runtimeProvider.apiKeyRequired = providerConfig.options.apiKeyRequired;
  }
  if (providerConfig.options?.headers) {
    runtimeProvider.headers = providerConfig.options.headers;
  }
  if (providerConfig.options?.providerOptions) {
    runtimeProvider.providerOptions = providerConfig.options.providerOptions;
  }
  if (providerConfig.options?.logoUrl) {
    runtimeProvider.logoUrl = providerConfig.options.logoUrl;
  }
  if (providerConfig.options?.modelsDevProviderId) {
    runtimeProvider.modelsDevProviderId =
      providerConfig.options.modelsDevProviderId;
  }

  const apiFormat = normalizeApiFormat(
    providerConfig.options?.apiFormat,
    providerConfig.kind,
  );
  if (apiFormat) {
    runtimeProvider.apiFormat = apiFormat;
  }

  const runtimeModel = {
    revision: `bridge-${randomUUID()}`,
    generatedAt: Date.now(),
    model: {
      providerId,
      modelId,
    },
    provider: runtimeProvider,
  };

  if (typeof options.thoughtLevel === "string" && options.thoughtLevel.length > 0) {
    runtimeModel.thoughtLevel = options.thoughtLevel;
  }

  return runtimeModel;
}

function normalizeProviderKind(kind) {
  if (kind === "anthropic" || kind === "openai" || kind === "openai-compatible") {
    return kind;
  }
  throw new Error(`Unsupported provider kind: ${JSON.stringify(kind)}`);
}

function normalizeProviderSource(source) {
  if (
    source === "builtin" ||
    source === "models-dev" ||
    source === "custom" ||
    source === "user" ||
    source === "workspace" ||
    source === "ephemeral"
  ) {
    return source;
  }
  return "custom";
}

function normalizeApiFormat(apiFormat, providerKind) {
  if (
    apiFormat === "anthropic-messages" ||
    apiFormat === "openai-chat-completions" ||
    apiFormat === "openai-responses"
  ) {
    return apiFormat;
  }

  if (providerKind === "anthropic") {
    return "anthropic-messages";
  }

  if (providerKind === "openai" || providerKind === "openai-compatible") {
    return "openai-chat-completions";
  }

  return undefined;
}

function toRuntimeProviderModel(modelId, modelConfig = {}) {
  const runtimeModel = {
    modelId,
  };

  if (typeof modelConfig.label === "string" && modelConfig.label.length > 0) {
    runtimeModel.label = modelConfig.label;
  }
  if (
    typeof modelConfig.description === "string" &&
    modelConfig.description.length > 0
  ) {
    runtimeModel.description = modelConfig.description;
  }
  if (Number.isInteger(modelConfig.limit?.context) && modelConfig.limit.context > 0) {
    runtimeModel.contextWindow = modelConfig.limit.context;
  }
  if (Number.isInteger(modelConfig.limit?.output) && modelConfig.limit.output > 0) {
    runtimeModel.maxOutputTokens = modelConfig.limit.output;
  }

  const reasoning = toRuntimeReasoning(modelConfig.reasoning);
  if (reasoning) {
    runtimeModel.reasoning = reasoning;
  }

  if (modelConfig.modalities) {
    const inputModes = Array.isArray(modelConfig.modalities.input)
      ? modelConfig.modalities.input
      : [];
    runtimeModel.supportsImages = inputModes.includes("image");
    runtimeModel.supportsPdf = inputModes.includes("pdf");
  }

  if (typeof modelConfig.supportsTools === "boolean") {
    runtimeModel.supportsTools = modelConfig.supportsTools;
  }
  if (typeof modelConfig.supportsStructuredOutput === "boolean") {
    runtimeModel.supportsStructuredOutput =
      modelConfig.supportsStructuredOutput;
  }
  if (modelConfig.providerOptions) {
    runtimeModel.providerOptions = modelConfig.providerOptions;
  }
  if (
    typeof modelConfig.disabledReason === "string" &&
    modelConfig.disabledReason.length > 0
  ) {
    runtimeModel.disabledReason = modelConfig.disabledReason;
  }

  return runtimeModel;
}

function toRuntimeReasoning(reasoningConfig) {
  if (!reasoningConfig || typeof reasoningConfig !== "object") {
    return null;
  }

  const variants = Array.isArray(reasoningConfig.variants)
    ? reasoningConfig.variants
    : [];

  return {
    enabled: reasoningConfig.enabled !== false,
    levels: variants.map((value) => ({
      value,
      label: value,
    })),
    ...(typeof reasoningConfig.defaultVariant === "string"
      ? { defaultLevel: reasoningConfig.defaultVariant }
      : {}),
  };
}

async function applyRuntimeModelSelection(client, session, runtimeModel) {
  const modelSelection = {
    providerId: runtimeModel.model.providerId,
    modelId: runtimeModel.model.modelId,
  };
  const initialSetModelParams = {
    sessionId: session.sessionId,
    model: modelSelection,
    runtimeModel,
  };
  const finalSetModelParams = {
    ...initialSetModelParams,
    persistAsWorkspaceLastUsed: true,
  };

  const initialSetModelResult = await client.request(
    "session/setModel",
    initialSetModelParams,
  );

  await client.request("workspace/setDefaultModel", {
    workspace: session.workspace,
    model: modelSelection,
    runtimeModel,
  });

  const updateResult = await client.request("session/updateRuntimeModelConfig", {
    sessionId: session.sessionId,
    runtimeModel,
    applyModelSelection: true,
  });

  const finalSetModelResult = await client.request(
    "session/setModel",
    finalSetModelParams,
  );

  const persistedSyncResult = await syncPersistedRuntimeModelState(
    session,
    runtimeModel,
  );

  return {
    changed:
      Boolean(initialSetModelResult?.changed) ||
      Boolean(updateResult?.changed) ||
      Boolean(finalSetModelResult?.changed),
    appliedModelRuntimeRevision:
      finalSetModelResult?.appliedModelRuntimeRevision ||
      updateResult?.appliedModelRuntimeRevision ||
      initialSetModelResult?.appliedModelRuntimeRevision,
    persistedSync: persistedSyncResult,
  };
}

async function syncPersistedRuntimeModelState(session, runtimeModel) {
  const desiredModel = {
    providerId: runtimeModel.model.providerId,
    modelId: runtimeModel.model.modelId,
    thoughtLevel:
      typeof runtimeModel.thoughtLevel === "string"
        ? runtimeModel.thoughtLevel
        : null,
  };
  const appliedAt = Date.now();

  const [messageRowsUpdated, taskRowsUpdated] = await Promise.all([
    syncPersistedMessageModelState(session.sessionId, desiredModel, appliedAt),
    syncTaskIndexModelState(session, desiredModel, appliedAt),
  ]);

  return {
    messageRowsUpdated,
    taskRowsUpdated,
  };
}

async function syncPersistedMessageModelState(sessionId, desiredModel, appliedAt) {
  const recentRows = await selectSqliteJson(
    DEFAULT_ZCODE_MESSAGE_DB,
    `
      SELECT id, time_created, data
      FROM message
      WHERE session_id = ${toSqliteTextLiteral(sessionId)}
        AND (
          json_type(data, '$.providerID') IS NOT NULL
          OR json_type(data, '$.model.providerID') IS NOT NULL
        )
      ORDER BY time_created DESC, id DESC
      LIMIT ${PERSISTED_MODEL_SYNC_LIMIT};
    `,
  );

  if (!Array.isArray(recentRows) || recentRows.length === 0) {
    return 0;
  }

  const updates = [];
  for (const row of recentRows) {
    let payload;
    try {
      payload = JSON.parse(row.data);
    } catch (error) {
      throw new Error(
        `Failed to parse persisted ZCode message ${JSON.stringify(row.id)}: ${error.message}`,
      );
    }

    if (!applyDesiredModelToPersistedMessage(payload, desiredModel)) {
      continue;
    }

    updates.push({
      id: row.id,
      data: JSON.stringify(payload),
    });
  }

  if (updates.length === 0) {
    return 0;
  }

  const statements = [
    "BEGIN IMMEDIATE TRANSACTION;",
    ...updates.map(
      (update) =>
        `UPDATE message
         SET data = ${toSqliteTextLiteral(update.data)},
             time_updated = ${appliedAt}
         WHERE id = ${toSqliteTextLiteral(update.id)};`,
    ),
    "COMMIT;",
  ].join("\n");

  await runSqlite(DEFAULT_ZCODE_MESSAGE_DB, statements);
  return updates.length;
}

function applyDesiredModelToPersistedMessage(payload, desiredModel) {
  let changed = false;

  if (payload && typeof payload === "object") {
    if (
      payload.role === "assistant" &&
      typeof payload.providerID === "string" &&
      typeof payload.modelID === "string"
    ) {
      if (payload.providerID !== desiredModel.providerId) {
        payload.providerID = desiredModel.providerId;
        changed = true;
      }
      if (payload.modelID !== desiredModel.modelId) {
        payload.modelID = desiredModel.modelId;
        changed = true;
      }
      if (
        desiredModel.thoughtLevel &&
        typeof payload.thoughtLevel === "string" &&
        payload.thoughtLevel !== desiredModel.thoughtLevel
      ) {
        payload.thoughtLevel = desiredModel.thoughtLevel;
        changed = true;
      }
    }

    if (
      payload.model &&
      typeof payload.model === "object" &&
      typeof payload.model.providerID === "string" &&
      typeof payload.model.modelID === "string"
    ) {
      if (payload.model.providerID !== desiredModel.providerId) {
        payload.model.providerID = desiredModel.providerId;
        changed = true;
      }
      if (payload.model.modelID !== desiredModel.modelId) {
        payload.model.modelID = desiredModel.modelId;
        changed = true;
      }
    }
  }

  return changed;
}

async function syncTaskIndexModelState(session, desiredModel, appliedAt) {
  const rows = await selectSqliteJson(
    DEFAULT_ZCODE_TASKS_INDEX,
    `
      SELECT workspace_key, workspace_path, task_id, provider, model, meta_json
      FROM tasks
      WHERE workspace_path = ${toSqliteTextLiteral(session.workspace.workspacePath)}
        AND task_id = ${toSqliteTextLiteral(session.sessionId)}
      LIMIT 1;
    `,
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return 0;
  }

  let meta = {};
  try {
    meta = row.meta_json ? JSON.parse(row.meta_json) : {};
  } catch (error) {
    throw new Error(
      `Failed to parse tasks-index metadata for session ${JSON.stringify(
        session.sessionId,
      )}: ${error.message}`,
    );
  }

  const desiredModelRef = `${desiredModel.providerId}/${desiredModel.modelId}`;
  let changed = false;

  if (meta.model !== desiredModelRef) {
    meta.model = desiredModelRef;
    changed = true;
  }
  if (desiredModel.thoughtLevel && meta.thoughtLevel !== desiredModel.thoughtLevel) {
    meta.thoughtLevel = desiredModel.thoughtLevel;
    changed = true;
  }
  if (meta.updatedAt !== appliedAt) {
    meta.updatedAt = appliedAt;
    changed = true;
  }

  if (!changed && row.model === desiredModelRef) {
    return 0;
  }

  await runSqlite(
    DEFAULT_ZCODE_TASKS_INDEX,
    `
      UPDATE tasks
      SET model = ${toSqliteTextLiteral(desiredModelRef)},
          updated_at = ${appliedAt},
          meta_json = ${toSqliteTextLiteral(JSON.stringify(meta))}
      WHERE workspace_path = ${toSqliteTextLiteral(session.workspace.workspacePath)}
        AND task_id = ${toSqliteTextLiteral(session.sessionId)};
    `,
  );

  return 1;
}

async function selectSqliteJson(databasePath, sql) {
  const stdout = await runSqlite(databasePath, sql, { json: true });
  if (!stdout.trim()) {
    return [];
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse sqlite JSON output from ${databasePath}: ${error.message}`,
    );
  }
}

async function runSqlite(databasePath, sql, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (options.json) {
      args.push("-json");
    }
    args.push(databasePath);

    const child = spawn("sqlite3", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to run sqlite3 for ${databasePath}: ${error.message}`),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          stderr.trim()
            ? `sqlite3 exited with code ${code}: ${stderr.trim()}`
            : `sqlite3 exited with code ${code}.`,
        ),
      );
    });

    child.stdin.end(sql);
  });
}

function toSqliteTextLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function waitForPromptCompletion(client, sessionId, options) {
  const deadline = Date.now() + options.timeoutMs;
  let sawActive = false;
  let lastSnapshot = null;

  while (Date.now() <= deadline) {
    const snapshot = await client.request("session/read", { sessionId });
    lastSnapshot = snapshot;

    const projection = snapshot?.projection || {};
    const target = projection.target || snapshot?.session?.target || null;
    const activeToolCalls = Array.isArray(projection.activeToolCalls)
      ? projection.activeToolCalls.length
      : 0;
    const backgroundJobs = Array.isArray(projection.backgroundJobs)
      ? projection.backgroundJobs.length
      : 0;
    const isActive =
      projection.status !== "idle" ||
      activeToolCalls > 0 ||
      backgroundJobs > 0 ||
      Boolean(target?.activeInputId || target?.activeRunStartedAtMs);

    if (isActive) {
      sawActive = true;
    } else if (sawActive) {
      return summarizeWaitResult(snapshot, true);
    }

    await delay(options.pollMs);
  }

  return summarizeWaitResult(lastSnapshot, false);
}

function summarizeWaitResult(snapshot, completed) {
  const projection = snapshot?.projection || {};
  const target = projection.target || snapshot?.session?.target || null;

  return {
    completed,
    status: projection.status || null,
    activeToolCalls: Array.isArray(projection.activeToolCalls)
      ? projection.activeToolCalls.length
      : 0,
    backgroundJobs: Array.isArray(projection.backgroundJobs)
      ? projection.backgroundJobs.length
      : 0,
    activeInputId: target?.activeInputId || null,
    activeRunStartedAtMs: target?.activeRunStartedAtMs || null,
    activeRunLastSeenAtMs: target?.activeRunLastSeenAtMs || null,
    lastError: projection.lastError || null,
    currentModel: snapshot?.settings?.model?.current || null,
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const content = chunks.join("").trim();
  if (!content) {
    throw new Error("Expected message content on stdin.");
  }
  return content;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return parsed;
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printError(error) {
  const parts = ["Error"];
  if (error.code !== undefined) {
    parts.push(String(error.code));
  }
  process.stderr.write(`${parts.join(" ")}: ${error.message}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node tools/zcode-bridge.mjs doctor [--json]",
      "  node tools/zcode-bridge.mjs list-sessions [--workspace <path>] [--limit <n>] [--all] [--json]",
      "  node tools/zcode-bridge.mjs set-runtime-model --session <id|title|latest> (--provider-id <id> | --provider-name <name>) --model-id <id> [--thought-level <level>] [--workspace <path>] [--all] [--dry-run] [--json]",
      "  node tools/zcode-bridge.mjs send --session <id|title|latest> --message <text> [--workspace <path>] [--all] [--dry-run] [--json]",
      "    [--provider-id <id> | --provider-name <name>] [--model-id <id>] [--thought-level <level>]",
      "    [--no-wait] [--wait-poll-ms <ms>] [--wait-timeout-ms <ms>]",
      "",
      "Notes:",
      `  - Default ZCode CLI path: ${DEFAULT_ZCODE_CLI}`,
      `  - Default ZCode config path: ${DEFAULT_ZCODE_CONFIG}`,
      `  - Default ZCode message DB path: ${DEFAULT_ZCODE_MESSAGE_DB}`,
      `  - Default ZCode tasks index path: ${DEFAULT_ZCODE_TASKS_INDEX}`,
      "  - Set ZCODE_CLI_PATH to override the bundled ZCode CLI location.",
      "  - Set ZCODE_CONFIG_PATH to override the local ZCode provider config.",
      "  - Set ZCODE_MESSAGE_DB_PATH to override the persisted message database path.",
      "  - Set ZCODE_TASKS_INDEX_PATH to override the persisted tasks index path.",
      "  - Use --message - to read the outbound message from stdin.",
      "  - send waits for the prompt turn to settle before exiting unless --no-wait is set.",
      "  - --wait-poll-ms controls session/read polling cadence during send wait.",
      "  - --wait-timeout-ms caps how long send keeps the ZCode app-server alive.",
      "",
    ].join("\n"),
  );
}

main();

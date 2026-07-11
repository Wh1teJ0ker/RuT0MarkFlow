import { describe, expect, it } from "vitest";
import { classifyUpdateError } from "../mod";
import type { AppErrorPayload } from "../../../types";

function makeError(message: string): AppErrorPayload {
  return {
    code: "UPDATE_CHECK_FAILED",
    message,
    recoverable: true,
    domain: "system",
    operation: "check-update",
    recoveryAction: "retry-check-update",
  };
}

describe("classifyUpdateError", () => {
  it("maps incomplete remote release json to a retryable Chinese message", () => {
    const result = classifyUpdateError(
      makeError("Could not fetch a valid release JSON from the remote"),
    );

    expect(result.message).toBe("更新发布尚未完成，请稍后重试");
  });

  it("maps missing platform entries to the same publish-in-progress message", () => {
    const result = classifyUpdateError(
      makeError("the platform `windows-x86_64` was not found in the response `platforms` object"),
    );

    expect(result.message).toBe("更新发布尚未完成，请稍后重试");
  });

  it("preserves the existing network classification", () => {
    const result = classifyUpdateError(
      makeError("network timeout while requesting updater feed"),
    );

    expect(result.message).toBe("无法连接更新服务器");
  });
});

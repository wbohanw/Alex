import { describe, expect, test } from "bun:test";
import { parseApprovalReply, parseMention } from "./mentions";

describe("parseMention", () => {
  test("ignores comments without a mention", () => {
    expect(parseMention("fix the login bug please", "alex")).toBeNull();
    expect(parseMention("email me at alex@example.com", "alex")).toBeNull();
  });

  test("work command with instructions", () => {
    expect(parseMention("@alex fix the flaky login test", "alex")).toEqual({
      kind: "work",
      instructions: "fix the flaky login test",
    });
  });

  test("matches [bot] suffix and mid-comment mentions", () => {
    expect(parseMention("hey @alex[bot] add dark mode", "alex")).toEqual({
      kind: "work",
      instructions: "add dark mode",
    });
  });

  test("review command", () => {
    expect(parseMention("@alex review", "alex")).toEqual({ kind: "review", instructions: "" });
    expect(parseMention("@alex review focus on error handling", "alex")).toEqual({
      kind: "review",
      instructions: "focus on error handling",
    });
  });

  test("approve and stop words", () => {
    expect(parseMention("@alex approved", "alex")).toEqual({ kind: "approve" });
    expect(parseMention("@alex lgtm!", "alex")).toEqual({ kind: "approve" });
    expect(parseMention("@alex stop", "alex")).toEqual({ kind: "stop" });
  });

  test("slug is regex-escaped and case-insensitive", () => {
    expect(parseMention("@Alex do the thing", "alex")).toEqual({
      kind: "work",
      instructions: "do the thing",
    });
  });
});

describe("parseApprovalReply", () => {
  test("classifies replies", () => {
    expect(parseApprovalReply("approved")).toBe("approve");
    expect(parseApprovalReply("LGTM")).toBe("approve");
    expect(parseApprovalReply("stop")).toBe("stop");
    expect(parseApprovalReply("use exponential backoff instead")).toBe("feedback");
    expect(parseApprovalReply("")).toBeNull();
  });
});

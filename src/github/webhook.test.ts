import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifySignature } from "./webhook";

const SECRET = "test-secret";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
  test("accepts a valid signature", () => {
    const body = JSON.stringify({ action: "created" });
    expect(verifySignature(SECRET, body, sign(body))).toBe(true);
  });

  test("rejects a tampered body", () => {
    const body = JSON.stringify({ action: "created" });
    expect(verifySignature(SECRET, body + " ", sign(body))).toBe(false);
  });

  test("rejects missing or malformed headers", () => {
    expect(verifySignature(SECRET, "{}", null)).toBe(false);
    expect(verifySignature(SECRET, "{}", "sha1=abc")).toBe(false);
    expect(verifySignature(SECRET, "{}", "sha256=zz")).toBe(false);
  });
});

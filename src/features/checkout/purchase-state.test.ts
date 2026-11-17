import { describe, expect, it } from "vitest";
import {
  parseAttempt,
  quoteNeedsReview,
  validLocalRedirect,
} from "./purchase-state";

describe("purchase context", () => {
  it("rejects another collector’s persisted purchase", () => {
    expect(
      parseAttempt(
        JSON.stringify({
          userId: "one",
          key: "key",
          quoteId: "q",
          walletId: "w",
        }),
        "two",
      ),
    ).toBeNull();
  });
  it("recovers all original purchase identifiers", () => {
    const attempt = { userId: "one", key: "key", quoteId: "q", walletId: "w" };
    expect(parseAttempt(JSON.stringify(attempt), "one")).toEqual(attempt);
    expect(parseAttempt("broken", "one")).toBeNull();
  });
  it("retains the original collector and provider for exact replay, while keeping corrupted intents recovery-only", () => {
    const attempt = {
      userId: "one",
      key: "key",
      quoteId: "q",
      walletId: "w",
      provider: "Coinbase Wallet",
      collector: {
        displayName: "Buyer",
        email: "buyer@kurio.test",
        username: "buyer",
        ens: "buyer.eth",
        note: "Original note",
      },
    };
    expect(parseAttempt(JSON.stringify(attempt), "one")).toEqual(attempt);
    expect(
      parseAttempt(
        JSON.stringify({
          ...attempt,
          collector: { ...attempt.collector, email: 123 },
        }),
        "one",
      ),
    ).toMatchObject({ key: "key", invalidIntent: true });
    expect(
      parseAttempt(JSON.stringify({ ...attempt, provider: "Unknown" }), "one"),
    ).toMatchObject({ key: "key", invalidIntent: true });
  });
  it("requires review for changed financial or availability fingerprints", () => {
    expect(
      quoteNeedsReview(
        { fingerprint: "a", version: 1 },
        { fingerprint: "b", version: 1 },
      ),
    ).toBe(true);
    expect(
      quoteNeedsReview(
        { fingerprint: "a", version: 1 },
        { fingerprint: "a", version: 2 },
      ),
    ).toBe(false);
    expect(
      quoteNeedsReview(
        { fingerprint: "a", version: 1 },
        { fingerprint: "a", version: 1 },
      ),
    ).toBe(false);
  });
  it("preserves only local return paths", () => {
    expect(validLocalRedirect("/checkout")).toBe("/checkout");
    expect(validLocalRedirect("//example.com")).toBe("/account");
    expect(validLocalRedirect("/\\example.com")).toBe("/account");
    expect(validLocalRedirect("https://example.com")).toBe("/account");
  });
});

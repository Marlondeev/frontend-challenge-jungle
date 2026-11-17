import type { CollectorSnapshot, Provider } from "@/domain/types";

export interface PurchaseAttempt {
  userId: string;
  key: string;
  quoteId: string;
  walletId: string;
  collector?: CollectorSnapshot;
  provider?: Provider;
  /** Corrupted optional data must not discard the key and permit a duplicate. */
  invalidIntent?: true;
}
export function parseAttempt(
  raw: string | null,
  userId: string,
): PurchaseAttempt | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (
      item.userId !== userId ||
      !["key", "quoteId", "walletId"].every(
        (key) => typeof item[key] === "string" && item[key],
      )
    )
      return null;
    const collector = item.collector;
    const validCollector =
      collector === undefined ||
      (collector !== null &&
        typeof collector === "object" &&
        ["displayName", "username", "email", "ens", "note"].every(
          (key) =>
            typeof (collector as Record<string, unknown>)[key] === "string",
        ));
    const validProvider =
      item.provider === undefined ||
      ["MetaMask", "WalletConnect", "Coinbase Wallet"].includes(
        String(item.provider),
      );
    return validCollector && validProvider
      ? (item as unknown as PurchaseAttempt)
      : {
          userId,
          key: String(item.key),
          quoteId: String(item.quoteId),
          walletId: String(item.walletId),
          invalidIntent: true,
        };
  } catch {
    return null;
  }
}
export function quoteNeedsReview(
  before: { fingerprint: string; version: number },
  after: { fingerprint: string; version: number },
) {
  // Quote.version is a revalidation revision; the fingerprint contains prices,
  // quantities, coupon and stock. Cart.version is checked separately at submit.
  return before.fingerprint !== after.fingerprint;
}
export function validLocalRedirect(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\r\n]/.test(value) &&
    !/^\/(login|register)(?:[/?#]|$)/.test(value)
    ? value
    : "/account";
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClientStorage, getStoredVisitorId } from "@/lib/client-storage";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("hosted Google demo storage", () => {
  it("keeps the hosted visitor and token storage scoped to this tab", () => {
    vi.stubEnv("VITE_GOOGLE_LOGIN", "vercel-demo");
    getClientStorage()!.setItem("kurio.session", "app-session");
    const visitor = getStoredVisitorId();
    expect(getStoredVisitorId()).toBe(visitor);
    expect(sessionStorage.getItem("kurio.session")).toBe("app-session");
    expect(sessionStorage.getItem("kurio.visitor")).toBe(visitor);
    expect(localStorage.getItem("kurio.session")).toBeNull();
    expect(localStorage.getItem("kurio.visitor")).toBeNull();
  });

  it.each([undefined, "real"])(
    "retains localStorage for existing mode %s",
    (mode) => {
      vi.stubEnv("VITE_GOOGLE_LOGIN", mode);
      const visitor = getStoredVisitorId();
      expect(getClientStorage()).toBe(localStorage);
      expect(localStorage.getItem("kurio.visitor")).toBe(visitor);
      expect(sessionStorage.getItem("kurio.visitor")).toBeNull();
    },
  );
});

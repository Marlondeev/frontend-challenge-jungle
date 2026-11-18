import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleCredentialRequest,
  mountGoogleIdentityButton,
  pendingGoogleChallenge,
  type GoogleIdentityApi,
  type GoogleIdentityConfiguration,
  type GoogleButtonConfiguration,
} from "@/lib/google-identity";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google credential lifetime", () => {
  it("returns the opaque credential with the server nonce once", async () => {
    const request = createGoogleCredentialRequest(
      "nonce-1",
      new AbortController().signal,
    );
    request.receive({ credential: "signed.jwt.value" });
    request.receive({ credential: "ignored" });
    await expect(request.promise).resolves.toEqual({
      credential: "signed.jwt.value",
      nonce: "nonce-1",
    });
  });

  it("rejects cancellation and ignores a late Google callback", async () => {
    const controller = new AbortController();
    const request = createGoogleCredentialRequest("nonce-2", controller.signal);
    controller.abort();
    request.receive({ credential: "late" });
    await expect(request.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not accept a credential for an already canceled attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = createGoogleCredentialRequest(
      "nonce-canceled",
      controller.signal,
    );
    request.receive({ credential: "ignored" });
    await expect(request.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ends an abandoned popup with an actionable timeout", async () => {
    vi.useFakeTimers();
    const request = createGoogleCredentialRequest(
      "nonce-3",
      new AbortController().signal,
      100,
    );
    const result = expect(request.promise).rejects.toThrow("Tente novamente");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    request.receive({ credential: "too-late" });
  });
});

describe("Google SDK ownership", () => {
  it("only routes clicks and credentials to the active mounted consumer", () => {
    const configurations: GoogleIdentityConfiguration[] = [];
    const buttons: GoogleButtonConfiguration[] = [];
    const sdk: GoogleIdentityApi = {
      initialize: (configuration) => {
        configurations.push(configuration);
      },
      renderButton: (_host, options) => {
        buttons.push(options);
      },
      cancel: vi.fn(),
    };
    const host = { replaceChildren: vi.fn() } as unknown as HTMLElement;
    const first = { click: vi.fn(), credential: vi.fn() };
    const second = { click: vi.fn(), credential: vi.fn() };
    const releaseFirst = mountGoogleIdentityButton(sdk, host, {
      clientId: "client",
      nonce: "one",
      width: 300,
      ...first,
    });
    const releaseSecond = mountGoogleIdentityButton(sdk, host, {
      clientId: "client",
      nonce: "two",
      width: 300,
      ...second,
    });
    releaseFirst();
    buttons[0].click_listener();
    configurations[0].callback({ credential: "old" });
    buttons[1].click_listener();
    configurations[1].callback({ credential: "new" });
    expect(first.click).not.toHaveBeenCalled();
    expect(first.credential).not.toHaveBeenCalled();
    expect(second.click).toHaveBeenCalledOnce();
    expect(second.credential).toHaveBeenCalledWith({ credential: "new" });
    releaseSecond();
    configurations[1].callback({ credential: "unmounted" });
    expect(second.credential).toHaveBeenCalledOnce();
    expect(sdk.cancel).toHaveBeenCalledOnce();
  });
});

describe("server nonce preparation", () => {
  it("shares only a pending challenge across StrictMode mounts, then refreshes", async () => {
    let finish!: (value: { nonce: string }) => void;
    const fetchChallenge = vi.fn(
      () =>
        new Promise<{ nonce: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const first = pendingGoogleChallenge(fetchChallenge);
    const second = pendingGoogleChallenge(fetchChallenge);
    expect(fetchChallenge).toHaveBeenCalledOnce();
    finish({ nonce: "first" });
    expect(await first).toEqual(await second);
    const next = pendingGoogleChallenge(async () => ({ nonce: "fresh" }));
    await expect(next).resolves.toEqual({ nonce: "fresh" });
  });

  it("allows preparation again after a failed challenge request", async () => {
    await expect(
      pendingGoogleChallenge(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    await expect(
      pendingGoogleChallenge(async () => ({ nonce: "recovered" })),
    ).resolves.toEqual({ nonce: "recovered" });
  });
});

describe("Google SDK loading", () => {
  it("uses one official script for overlapping loads and permits retry after failure", async () => {
    vi.resetModules();
    const scripts: (EventTarget & {
      src: string;
      remove: ReturnType<typeof vi.fn>;
    })[] = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () =>
        Object.assign(new EventTarget(), { src: "", remove: vi.fn() }),
      head: {
        appendChild: (script: (typeof scripts)[number]) => {
          scripts.push(script);
        },
      },
    });
    const { loadGoogleIdentity } = await import("@/lib/google-identity");
    const first = loadGoogleIdentity();
    const second = loadGoogleIdentity();
    const firstFailure = expect(first).rejects.toThrow("Google");
    const secondFailure = expect(second).rejects.toThrow("Google");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://accounts.google.com/gsi/client");
    scripts[0].dispatchEvent(new Event("error"));
    await Promise.all([firstFailure, secondFailure]);
    expect(scripts[0].remove).toHaveBeenCalled();
    const retried = loadGoogleIdentity();
    expect(scripts).toHaveLength(2);
    const sdk = { initialize: vi.fn(), renderButton: vi.fn() };
    Object.assign(window, { google: { accounts: { id: sdk } } });
    scripts[1].dispatchEvent(new Event("load"));
    await expect(retried).resolves.toBe(sdk);
  });

  it("removes an SDK script that never loads and permits retry", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const scripts: (EventTarget & { remove: ReturnType<typeof vi.fn> })[] = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () =>
        Object.assign(new EventTarget(), { remove: vi.fn() }),
      head: {
        appendChild: (script: (typeof scripts)[number]) => {
          scripts.push(script);
        },
      },
    });
    const { loadGoogleIdentity } = await import("@/lib/google-identity");
    const failed = expect(loadGoogleIdentity()).rejects.toThrow("Google");
    await vi.advanceTimersByTimeAsync(12_000);
    await failed;
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    const retried = loadGoogleIdentity();
    expect(scripts).toHaveLength(2);
    const sdk = { initialize: vi.fn(), renderButton: vi.fn() };
    Object.assign(window, { google: { accounts: { id: sdk } } });
    scripts[1].dispatchEvent(new Event("load"));
    await expect(retried).resolves.toBe(sdk);
  });
});

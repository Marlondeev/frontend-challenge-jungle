import { afterEach, describe, expect, it } from "vitest";
import {
  createBackend,
  memoryStorage,
  STORAGE_KEY,
} from "../../src/mocks/backend";
import type { GoogleIdentity } from "../../src/domain/types";
import type { StorageCoordinator } from "../../src/mocks/storage-coordinator";

const identity = (overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: "google-subject-a",
  email: "collector@example.com",
  emailVerified: true,
  name: "Google Collector",
  picture: "https://lh3.googleusercontent.com/a/profile-image",
  ...overrides,
});
const backends: ReturnType<typeof createBackend>[] = [];
function setup(storage = memoryStorage(), coordinate?: StorageCoordinator) {
  let clock = Date.UTC(2026, 10, 17, 12);
  const backend = createBackend({
    storage,
    schedule: false,
    now: () => clock,
    coordinate,
  });
  backends.push(backend);
  return {
    backend,
    storage,
    advance: (milliseconds: number) => (clock += milliseconds),
  };
}
afterEach(() => backends.splice(0).forEach((backend) => backend.dispose()));

describe("verified Google account domain", () => {
  it("creates a Google-only identity with no password or fictional wallet", async () => {
    const { backend, storage } = setup();
    const result = await backend.loginGoogle(identity());
    expect(result.session.user).toMatchObject({
      email: "collector@example.com",
      displayName: "Google Collector",
      authProvider: "google",
      avatar: "https://lh3.googleusercontent.com/a/profile-image",
    });
    expect(result.session.user!.id).not.toBe("collector@example.com");
    expect(result.session.user!.username).toMatch(/^[a-zA-Z0-9_.-]{3,24}$/);
    expect(
      await backend.request("GET", "/wallets", {}, { token: result.token }),
    ).toEqual([]);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.passwords[result.session.user!.id]).toBeUndefined();
    expect(result.session.expiresAt).toBe("2026-11-17T13:00:00.000Z");
  });

  it("uses the immutable Google subject on return and preserves saved profile changes", async () => {
    const { backend, storage } = setup();
    const first = await backend.loginGoogle(identity());
    const context = { token: first.token };
    await backend.request(
      "PATCH",
      "/profile",
      {
        displayName: "My saved name",
        username: "saved.collector",
        email: "contact@example.com",
        walletAlias: "My wallet",
        ens: "collector.eth",
        avatar: "",
      },
      context,
    );
    const fresh = setup(storage).backend;
    const returning = await fresh.loginGoogle(
      identity({
        email: "new-google-email@example.com",
        name: "Remote updated name",
      }),
    );
    expect(returning.token).not.toBe(first.token);
    expect(returning.session.user).toMatchObject({
      id: first.session.user!.id,
      displayName: "My saved name",
      username: "saved.collector",
      email: "contact@example.com",
      walletAlias: "My wallet",
      ens: "collector.eth",
      avatar: "",
      authProvider: "google",
    });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(3);
  });

  it("does not link a new subject to an existing password account by email", async () => {
    const { backend, storage } = setup();
    await expect(
      backend.loginGoogle(identity({ email: "colecionador@kurio.test" })),
    ).rejects.toMatchObject({ status: 409, code: "ACCOUNT_EXISTS" });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(2);
    const local = await backend.request("POST", "/session/login", {
      email: "colecionador@kurio.test",
      password: "Kurio123!",
    });
    expect(local.session.user.id).toBe("user-collector");
  });

  it("does not link different Google subjects sharing an email", async () => {
    const { backend } = setup();
    const first = await backend.loginGoogle(identity());
    await expect(
      backend.loginGoogle(identity({ sub: "different-google-subject" })),
    ).rejects.toMatchObject({ status: 409, code: "ACCOUNT_EXISTS" });
    expect(
      (await backend.request("GET", "/session", {}, { token: first.token }))
        .user.id,
    ).toBe(first.session.user!.id);
  });

  it.each([
    { sub: "" },
    { sub: "  " },
    { sub: "x".repeat(256) },
    { sub: "bad\nsubject" },
    { sub: "\ud800" },
    { email: "invalid" },
    { email: "collector\u0000@example.com" },
    { emailVerified: false },
    { picture: "javascript:alert(1)" },
    { picture: "http://example.com/image.png" },
    { picture: "https://user:password@example.com/image.png" },
  ])(
    "rejects malformed or unverified identity fields %#",
    async (overrides) => {
      const { backend, storage } = setup();
      await expect(
        backend.loginGoogle(identity(overrides)),
      ).rejects.toMatchObject({ status: 422, code: "INVALID_GOOGLE_IDENTITY" });
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(2);
    },
  );

  it("normalizes verified email and supplies a usable name when Google omits it", async () => {
    const { backend } = setup();
    const result = await backend.loginGoogle(
      identity({
        email: "  COLLECTOR@EXAMPLE.COM  ",
        name: undefined,
        picture: undefined,
      }),
    );
    expect(result.session.user!.email).toBe("collector@example.com");
    expect(result.session.user!.displayName.length).toBeGreaterThanOrEqual(2);
    expect(result.session.user!.avatar).toBeUndefined();
  });

  it("defers guest-cart transfer until the issued token is actually accepted, exactly once", async () => {
    const { backend } = setup();
    const guest = { visitorId: "google-guest" };
    await backend.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      guest,
    );
    const result = await backend.loginGoogle(identity(), guest);
    expect(
      (await backend.request("GET", "/cart", {}, guest)).items[0].quantity,
    ).toBe(2);
    const context = { ...guest, token: result.token };
    await backend.request("GET", "/session", {}, context);
    await backend.request("GET", "/session", {}, context);
    expect(
      (await backend.request("GET", "/cart", {}, context)).items[0].quantity,
    ).toBe(2);
    expect((await backend.request("GET", "/cart", {}, guest)).items).toEqual(
      [],
    );
  });

  it("keeps two Google owners' carts and favorites isolated", async () => {
    const { backend } = setup();
    const a = await backend.loginGoogle(identity());
    const aContext = { token: a.token };
    await backend.request("POST", "/favorites/emerald-ape-042", {}, aContext);
    await backend.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      aContext,
    );
    const b = await backend.loginGoogle(
      identity({ sub: "google-subject-b", email: "other@example.com" }),
    );
    expect(b.session.user!.id).not.toBe(a.session.user!.id);
    expect(
      await backend.request("GET", "/favorites", {}, { token: b.token }),
    ).toEqual([]);
    expect(
      (await backend.request("GET", "/cart", {}, { token: b.token })).items,
    ).toEqual([]);
    expect(
      (await backend.request("GET", "/cart", {}, aContext)).items[0].quantity,
    ).toBe(2);
  });

  it("coordinates simultaneous logins from separate backends without duplicating an identity or losing cart state", async () => {
    const storage = memoryStorage();
    const a = setup(storage).backend;
    const b = setup(storage).backend;
    const [first, second] = await Promise.all([
      a.loginGoogle(identity()),
      b.loginGoogle(identity()),
    ]);
    expect(first.session.user!.id).toBe(second.session.user!.id);
    await a.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      { token: first.token },
    );
    const returning = await b.loginGoogle(identity());
    expect(
      (await a.request("GET", "/cart", {}, { token: returning.token })).items[0]
        .quantity,
    ).toBe(2);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(3);
    expect(
      (await b.request("GET", "/session", {}, { token: second.token })).user.id,
    ).toBe(first.session.user!.id);
  });

  it("rejects canceled identity commits, including cancellation while waiting on storage", async () => {
    let hold = false;
    let release!: () => void;
    const coordinate: StorageCoordinator = (operation) =>
      hold
        ? new Promise((resolve, reject) => {
            release = () => {
              try {
                resolve(operation());
              } catch (error) {
                reject(error);
              }
            };
          })
        : Promise.resolve().then(operation);
    const { backend, storage } = setup(memoryStorage(), coordinate);
    await backend.ready;
    hold = true;
    const controller = new AbortController();
    const pending = backend.loginGoogle(identity(), {
      signal: controller.signal,
    });
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(2);
  });

  it("does not accept password login or password changes for a Google-only account", async () => {
    const { backend, storage } = setup();
    const result = await backend.loginGoogle(identity());
    await expect(
      backend.request("POST", "/session/login", {
        email: "collector@example.com",
        password: "Kurio123!",
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(
      backend.request(
        "PATCH",
        "/profile/password",
        { currentPassword: "Kurio123!", newPassword: "Other123!" },
        { token: result.token },
      ),
    ).rejects.toMatchObject({ status: 422, code: "SOCIAL_AUTH_ONLY" });
    expect(
      (await backend.request("GET", "/session", {}, { token: result.token }))
        .user.authProvider,
    ).toBe("google");
    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).passwords[
        result.session.user!.id
      ],
    ).toBeUndefined();
  });

  it("does not expose the trusted identity method through generic REST dispatch", async () => {
    const { backend, storage } = setup();
    await expect(
      backend.request("POST", "/session/google", identity()),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).users).toHaveLength(2);
  });

  it("retains actual session expiry and allows Google authentication after explicit expiry", async () => {
    const { backend, advance } = setup();
    const first = await backend.loginGoogle(identity());
    advance(3_600_000);
    await expect(
      backend.request("GET", "/session", {}, { token: first.token }),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await backend.request("POST", "/__control", {
      action: "scenario",
      scenario: "expired-session",
    });
    const next = await backend.loginGoogle(identity());
    expect(next.session.user!.id).toBe(first.session.user!.id);
    expect(
      (await backend.request("GET", "/session", {}, { token: next.token })).user
        .id,
    ).toBe(first.session.user!.id);
  });
});

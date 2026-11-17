import { describe, expect, it } from "vitest";
import type { AuthResult, Cart, Session, User } from "../../src/domain/types";
import {
  createBackend,
  memoryStorage,
  STORAGE_KEY,
} from "../../src/mocks/backend";

const now = () => Date.parse("2026-11-17T12:00:00Z");
const setup = () => {
  const storage = memoryStorage();
  return {
    storage,
    backend: createBackend({ storage, schedule: false, now }),
  };
};

describe("explicit social demonstration sessions", () => {
  it.each([
    ["google", "user-collector"],
    ["facebook", "user-nova"],
  ])(
    "persists the %s fixture's session and follows its stable ID",
    async (provider, userId) => {
      const { backend, storage } = setup();
      const auth: AuthResult = await backend.request(
        "POST",
        "/session/social-demo",
        { provider },
        { visitorId: `social-${provider}` },
      );
      expect(auth.token).toEqual(expect.any(String));
      expect(auth.session.user?.id).toBe(userId);
      expect(auth.session.expiresAt).toBe("2026-11-17T13:00:00.000Z");
      const context = { token: auth.token };
      await backend.request(
        "PATCH",
        "/profile",
        { email: `${provider}-edited@kurio.test` },
        context,
      );
      const restored = createBackend({ storage, schedule: false, now });
      const persisted: Session = await restored.request(
        "GET",
        "/session",
        {},
        context,
      );
      expect(persisted.user).toMatchObject({
        id: userId,
        email: `${provider}-edited@kurio.test`,
      });
      const again: AuthResult = await restored.request(
        "POST",
        "/session/social-demo",
        { provider },
      );
      expect(again.session.user).toMatchObject({
        id: userId,
        email: `${provider}-edited@kurio.test`,
      });
    },
  );

  it("merges the visitor's cart only into the selected demo account and isolates private resources", async () => {
    const { backend, storage } = setup();
    const add = { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 };
    const collector: AuthResult = await backend.request(
      "POST",
      "/session/social-demo",
      { provider: "google" },
    );
    const collectorContext = { token: collector.token };
    await backend.request("POST", "/cart/items", add, collectorContext);
    await backend.request(
      "POST",
      "/favorites/emerald-ape-042",
      {},
      collectorContext,
    );
    const visitor = { visitorId: "social-cart-guest" };
    await backend.request(
      "POST",
      "/cart/items",
      { ...add, quantity: 2 },
      visitor,
    );
    await backend.request("PUT", "/cart/coupon", { code: "KURIO10" }, visitor);

    const nova: AuthResult = await backend.request(
      "POST",
      "/session/social-demo",
      { provider: "facebook" },
      visitor,
    );
    const novaContext = { ...visitor, token: nova.token };
    const merged: Cart = await backend.request("GET", "/cart", {}, novaContext);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].quantity).toBe(2);
    expect(merged.coupon).toBe("KURIO10");
    expect((await backend.request("GET", "/cart", {}, visitor)).items).toEqual(
      [],
    );
    expect(
      (await backend.request("GET", "/cart", {}, collectorContext)).items[0]
        .quantity,
    ).toBe(1);
    expect(await backend.request("GET", "/favorites", {}, novaContext)).toEqual(
      [],
    );
    expect(
      await backend.request("GET", "/favorites", {}, collectorContext),
    ).toEqual(["emerald-ape-042"]);
    const restored = createBackend({ storage, schedule: false, now });
    expect(
      (await restored.request("GET", "/cart", {}, novaContext)).items[0]
        .quantity,
    ).toBe(2);
  });

  it("leaves the guest cart untouched until a social token is used, then merges exactly once across reloads", async () => {
    const { backend, storage } = setup();
    const visitor = { visitorId: "deferred-social-merge" };
    const add = { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 };
    await backend.request("POST", "/cart/items", add, visitor);
    const auth: AuthResult = await backend.request(
      "POST",
      "/session/social-demo",
      { provider: "facebook" },
      visitor,
    );
    expect(
      (await backend.request("GET", "/cart", {}, visitor)).items[0]?.quantity,
    ).toBe(2);
    const restored = createBackend({ storage, schedule: false, now });
    const context = { ...visitor, token: auth.token };
    await restored.request("GET", "/session", {}, context);
    expect((await restored.request("GET", "/cart", {}, visitor)).items).toEqual(
      [],
    );
    expect(
      (await restored.request("GET", "/cart", {}, context)).items[0].quantity,
    ).toBe(2);
    await restored.request(
      "POST",
      "/cart/items",
      { ...add, quantity: 1 },
      visitor,
    );
    const again = createBackend({ storage, schedule: false, now });
    await again.request("GET", "/session", {}, context);
    expect(
      (await again.request("GET", "/cart", {}, context)).items[0].quantity,
    ).toBe(2);
    expect(
      (await again.request("GET", "/cart", {}, visitor)).items[0].quantity,
    ).toBe(1);
  });

  it.each(["expired", "logged-out"])(
    "does not merge guest items when an unused social token is %s",
    async (outcome) => {
      const storage = memoryStorage();
      let clock = now();
      const backend = createBackend({
        storage,
        schedule: false,
        now: () => clock,
      });
      const visitor = { visitorId: `unused-${outcome}` };
      await backend.request(
        "POST",
        "/cart/items",
        { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
        visitor,
      );
      const auth: AuthResult = await backend.request(
        "POST",
        "/session/social-demo",
        { provider: "google" },
        visitor,
      );
      const context = { ...visitor, token: auth.token };
      if (outcome === "expired") clock += 3_600_001;
      else await backend.request("POST", "/session/logout", {}, context);
      await expect(
        backend.request("GET", "/session", {}, context),
      ).rejects.toMatchObject({ status: 401 });
      expect(
        (await backend.request("GET", "/cart", {}, visitor)).items[0]?.quantity,
      ).toBe(1);
      const state = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(state.carts["user-collector"]?.items ?? []).toEqual([]);
    },
  );

  it.each([undefined, "apple", "Google", "__proto__"])(
    "rejects unsupported provider %s without issuing a session or consuming the guest cart",
    async (provider) => {
      const { backend, storage } = setup();
      const context = { visitorId: "unsupported-social" };
      await backend.request(
        "POST",
        "/cart/items",
        { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
        context,
      );
      await expect(
        backend.request("POST", "/session/social-demo", { provider }, context),
      ).rejects.toMatchObject({ status: 422, code: "INVALID_SOCIAL_PROVIDER" });
      expect(
        (await backend.request("GET", "/cart", {}, context)).items,
      ).toHaveLength(1);
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).sessions).toEqual({});
    },
  );

  it("reports a missing demo fixture instead of authenticating another identity", async () => {
    const { backend, storage } = setup();
    await backend.request("POST", "/__control", { action: "reset" });
    const state = JSON.parse(storage.getItem(STORAGE_KEY)!);
    state.users = state.users.filter((user: User) => user.id !== "user-nova");
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    const restored = createBackend({ storage, schedule: false, now });
    await expect(
      restored.request("POST", "/session/social-demo", {
        provider: "facebook",
      }),
    ).rejects.toMatchObject({ status: 503, code: "SOCIAL_DEMO_UNAVAILABLE" });
  });

  it("keeps password validation and guest cart intact when the password is incorrect", async () => {
    const { backend, storage } = setup();
    const visitor = { visitorId: "wrong-password" };
    await backend.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      visitor,
    );
    await expect(
      backend.request(
        "POST",
        "/session/login",
        { email: "colecionador@kurio.test", password: "incorrect" },
        visitor,
      ),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    expect(
      (await backend.request("GET", "/cart", {}, visitor)).items,
    ).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).sessions).toEqual({});
    const valid: AuthResult = await backend.request(
      "POST",
      "/session/login",
      { email: "colecionador@kurio.test", password: "Kurio123!" },
      visitor,
    );
    expect(valid.session.user?.id).toBe("user-collector");
    expect((await backend.request("GET", "/cart", {}, visitor)).items).toEqual(
      [],
    );
    expect(
      (await backend.request("GET", "/cart", {}, { token: valid.token })).items,
    ).toHaveLength(1);
  });
});

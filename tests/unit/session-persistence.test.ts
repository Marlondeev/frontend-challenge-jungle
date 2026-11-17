import { describe, expect, it, vi } from "vitest";
import {
  createBackend,
  memoryStorage,
  STORAGE_KEY,
  type RequestContext,
} from "../../src/mocks/backend";
import { createStorageCoordinator } from "../../src/mocks/storage-coordinator";

const credentials = {
  email: "colecionador@kurio.test",
  password: "Kurio123!",
};
const start = Date.parse("2026-11-17T12:00:00Z");
function setup(schedule = false) {
  let time = start;
  const storage = memoryStorage();
  const options = { storage, now: () => time, schedule };
  const first = createBackend(options);
  const second = createBackend(options);
  return { first, second, storage, advance: (ms: number) => (time += ms) };
}
async function login(backend: ReturnType<typeof createBackend>) {
  const auth = await backend.request("POST", "/session/login", credentials, {
    visitorId: "shared-visitor",
  });
  return { token: auth.token, visitorId: "shared-visitor" } as RequestContext;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("sessions over shared persistent storage", () => {
  it("accepts a newly issued session in a backend opened before login", async () => {
    const { first, second, storage } = setup();
    const context = await login(first);
    await expect(
      second.request("GET", "/session", {}, context),
    ).resolves.toMatchObject({
      user: { id: "user-collector" },
      expiresAt: "2026-11-17T13:00:00.000Z",
    });
    await second.request("GET", "/nfts");
    await expect(
      first.request("GET", "/session", {}, context),
    ).resolves.toMatchObject({
      user: { id: "user-collector" },
    });
    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).sessions[context.token!]
        .expiresAt,
    ).toBe(start + 3_600_000);
  });

  it("preserves independent profile, stock, cart and order updates between instances", async () => {
    const { first, second } = setup();
    const context = await login(first);
    await first.request(
      "PATCH",
      "/profile",
      { displayName: "Shared collector" },
      context,
    );
    await second.request("POST", "/__control", {
      action: "nft-update",
      nftId: "emerald-ape-042",
      stock: 7,
    });
    await first.request(
      "POST",
      "/cart/items",
      {
        nftId: "emerald-ape-042",
        editionId: "ten",
        quantity: 2,
      },
      context,
    );
    const quote = await second.request("POST", "/quote", {}, context);
    const wallet = (await first.request("GET", "/wallets", {}, context))[0];
    const input = {
      quoteId: quote.id,
      walletId: wallet.id,
      idempotencyKey: "shared-order",
    };
    const order = await first.request("POST", "/orders", input, context);
    await second.request("GET", "/nfts");
    expect(await second.request("POST", "/orders", input, context)).toEqual(
      order,
    );
    expect(await first.request("GET", "/profile", {}, context)).toMatchObject({
      displayName: "Shared collector",
    });
    const nft = await first.request("GET", "/nfts/emerald-ape-042");
    expect(
      nft.editions.find((edition: { id: string }) => edition.id === "ten")
        .stock,
    ).toBe(7);
    expect(
      (await second.request("GET", "/cart", {}, context)).items[0].quantity,
    ).toBe(2);
  });

  it("keeps concurrent updates from both instances", async () => {
    const { first, second } = setup();
    const context = await login(first);
    await Promise.all([
      first.request("POST", "/favorites/emerald-ape-042", {}, context),
      second.request("POST", "/favorites/sage-nomad-009", {}, context),
    ]);
    expect(await first.request("GET", "/favorites", {}, context)).toEqual([
      "emerald-ape-042",
      "sage-nomad-009",
    ]);
  });

  it("does not overwrite unrelated updates while registration hashes outside the transaction", async () => {
    const { first, second, storage } = setup();
    const hashing = deferred(),
      release = deferred();
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let held = false;
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockImplementation(async (...args) => {
        const result = await deriveBits(...args);
        if (!held) {
          held = true;
          hashing.resolve();
          await release.promise;
        }
        return result;
      });
    try {
      const registration = first.request("POST", "/session/register", {
        email: "new-shared@kurio.test",
        username: "new-shared",
        password: "NewPassword123!",
      });
      await hashing.promise;
      await second.request(
        "POST",
        "/cart/items",
        {
          nftId: "emerald-ape-042",
          editionId: "ten",
          quantity: 3,
        },
        { visitorId: "other-visitor" },
      );
      await second.request("POST", "/__control", {
        action: "nft-update",
        stock: 8,
      });
      release.resolve();
      await registration;
      const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(saved.carts["guest:other-visitor"].items[0].quantity).toBe(3);
      expect(
        saved.nfts.find((nft: { id: string }) => nft.id === "emerald-ape-042")
          .editions[0].stock,
      ).toBe(8);
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  });

  it("rechecks registration uniqueness after concurrent hashes in separate instances", async () => {
    const { first, second, storage } = setup();
    const input = {
      email: "shared@kurio.test",
      username: "shared-user",
      password: "Shared123!",
    };
    const results = await Promise.allSettled([
      first.request("POST", "/session/register", input),
      second.request("POST", "/session/register", input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { status: 409, code: "ACCOUNT_EXISTS" },
    });
    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).users.filter(
        (user: { email: string }) => user.email === input.email,
      ),
    ).toHaveLength(1);
  });

  it("commits only one of two competing password changes without holding a crypto lock", async () => {
    const { first, second, storage } = setup();
    const context = await login(first);
    const previous = JSON.parse(storage.getItem(STORAGE_KEY)!).passwords[
      "user-collector"
    ];
    const bothValidated = deferred(),
      releaseFirstHash = deferred();
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let validations = 0,
      newHashes = 0;
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockImplementation(async (...args) => {
        const result = await deriveBits(...args);
        const salt = new TextDecoder().decode((args[0] as Pbkdf2Params).salt);
        if (salt === previous.salt) {
          if (++validations === 2) bothValidated.resolve();
          await bothValidated.promise;
        } else if (++newHashes === 1) await releaseFirstHash.promise;
        return result;
      });
    try {
      const results = await Promise.allSettled(
        [first, second].map((backend, index) =>
          backend
            .request(
              "PATCH",
              "/profile/password",
              {
                currentPassword: "Kurio123!",
                newPassword: `Changed${index}123!`,
              },
              context,
            )
            .finally(releaseFirstHash.resolve),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { status: 409, code: "PASSWORD_CHANGED" },
      });
      const winner = results.findIndex(
        (result) => result.status === "fulfilled",
      );
      await expect(
        first.request("POST", "/session/login", {
          ...credentials,
          password: `Changed${winner}123!`,
        }),
      ).resolves.toHaveProperty("token");
    } finally {
      bothValidated.resolve();
      releaseFirstHash.resolve();
      spy.mockRestore();
    }
  });

  it("reloads a constructor snapshot after waiting for the native storage lock", async () => {
    const { first, storage } = setup();
    const context = await login(first);
    const entered = deferred(),
      release = deferred();
    const locks = {
      request: async <T>(_name: string, operation: () => T) => {
        entered.resolve();
        await release.promise;
        return operation();
      },
    } as Pick<LockManager, "request">;
    const delayed = createBackend({
      storage,
      schedule: false,
      now: () => start,
      coordinate: createStorageCoordinator(storage, STORAGE_KEY, locks),
    });
    try {
      await entered.promise;
      await first.request(
        "PATCH",
        "/profile",
        { displayName: "Committed while opening" },
        context,
      );
      release.resolve();
      await delayed.ready;
      await expect(
        delayed.request("GET", "/profile", {}, context),
      ).resolves.toMatchObject({
        displayName: "Committed while opening",
      });
    } finally {
      release.resolve();
      delayed.dispose();
    }
  });

  it("rejects a password commit whose token was logged out during hashing", async () => {
    const { first, second } = setup();
    const context = await login(first);
    const hashing = deferred(),
      release = deferred();
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let calls = 0;
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockImplementation(async (...args) => {
        const result = await deriveBits(...args);
        if (++calls === 2) {
          hashing.resolve();
          await release.promise;
        }
        return result;
      });
    try {
      const password = first.request(
        "PATCH",
        "/profile/password",
        {
          currentPassword: "Kurio123!",
          newPassword: "Changed123!",
        },
        context,
      );
      await hashing.promise;
      await second.request("POST", "/session/logout", {}, context);
      release.resolve();
      await expect(password).rejects.toMatchObject({ status: 401 });
      await expect(login(second)).resolves.toHaveProperty("token");
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  });

  it("does not issue a login token after credentials change during verification", async () => {
    const { first, second } = setup();
    const context = await login(second);
    const hashing = deferred(),
      release = deferred();
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let held = false;
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockImplementation(async (...args) => {
        const result = await deriveBits(...args);
        if (!held) {
          held = true;
          hashing.resolve();
          await release.promise;
        }
        return result;
      });
    try {
      const staleLogin = login(first);
      await hashing.promise;
      await second.request(
        "PATCH",
        "/profile/password",
        {
          currentPassword: "Kurio123!",
          newPassword: "Changed123!",
        },
        context,
      );
      release.resolve();
      await expect(staleLogin).rejects.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
      });
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  });

  it("settles a shared pending order once when an older instance's timer also wakes", async () => {
    vi.useFakeTimers();
    const { first, second, advance, storage } = setup(true);
    let third: ReturnType<typeof createBackend> | undefined;
    try {
      const context = await login(first);
      await first.request(
        "POST",
        "/cart/items",
        {
          nftId: "emerald-ape-042",
          editionId: "one",
          quantity: 1,
        },
        context,
      );
      const quote = await first.request("POST", "/quote", {}, context);
      const wallet = (await first.request("GET", "/wallets", {}, context))[0];
      const order = await first.request(
        "POST",
        "/orders",
        {
          quoteId: quote.id,
          walletId: wallet.id,
          idempotencyKey: "shared-timer",
        },
        context,
      );
      third = createBackend({
        storage,
        now: () => start + 1_600,
        schedule: true,
      });
      await third.request(
        "PATCH",
        "/profile",
        { displayName: "After timer opened" },
        context,
      );
      advance(1_600);
      await vi.advanceTimersByTimeAsync(1_600);
      const receipt = await second.request(
        "GET",
        `/orders/${order.id}`,
        {},
        context,
      );
      expect(receipt).toMatchObject({ status: "confirmed", version: 2 });
      const nft = await second.request("GET", "/nfts/emerald-ape-042");
      expect(
        nft.editions.find((edition: { id: string }) => edition.id === "one")
          .stock,
      ).toBe(0);
      expect(
        (await first.request("GET", "/profile", {}, context)).displayName,
      ).toBe("After timer opened");
      const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(
        saved.eventHistory.filter(
          (event: {
            name: string;
            event: { resourceId: string; version: number };
          }) =>
            event.name === "order.updated" &&
            event.event.resourceId === order.id &&
            event.event.version === 2,
        ),
      ).toHaveLength(1);
    } finally {
      first.dispose();
      second.dispose();
      third?.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["password", "social"])(
    "recovers from the persistent expiry demo after valid %s login",
    async (kind) => {
      const { first, second, advance } = setup();
      await first.request("POST", "/__control", {
        action: "scenario",
        scenario: "expired-session",
      });
      const auth =
        kind === "password"
          ? await first.request("POST", "/session/login", credentials)
          : await first.request("POST", "/session/social-demo", {
              provider: "google",
            });
      const context = { token: auth.token };
      expect(second.state().scenario).toBe("success");
      await expect(
        second.request("GET", "/session", {}, context),
      ).resolves.toMatchObject({
        user: { id: "user-collector" },
        expiresAt: "2026-11-17T13:00:00.000Z",
      });
      advance(3_600_000);
      await expect(
        first.request("GET", "/session", {}, context),
      ).rejects.toMatchObject({ status: 401 });
      const next = await first.request("POST", "/session/social-demo", {
        provider: "google",
      });
      await second.request("POST", "/__control", { action: "expire" });
      await expect(
        first.request("GET", "/session", {}, { token: next.token }),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it("uses current pure read views without consuming deferred guest carts", async () => {
    const { first, second, storage } = setup();
    await first.request(
      "POST",
      "/cart/items",
      {
        nftId: "emerald-ape-042",
        editionId: "ten",
        quantity: 1,
      },
      { visitorId: "unaccepted" },
    );
    const auth = await first.request(
      "POST",
      "/session/social-demo",
      { provider: "google" },
      {
        visitorId: "unaccepted",
      },
    );
    const before = storage.getItem(STORAGE_KEY);
    expect(second.socketUser(auth.token)).toBe("user-collector");
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(
      JSON.parse(before!).carts["guest:unaccepted"].items[0].quantity,
    ).toBe(1);
    await first.request("POST", "/__control", { action: "expire" });
    const expired = storage.getItem(STORAGE_KEY);
    expect(second.socketUser(auth.token)).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBe(expired);
  });

  it("keeps all settlement records attached while socket listeners read reentrantly", async () => {
    const { first, advance } = setup();
    const context = await login(first);
    const wallet = (await first.request("GET", "/wallets", {}, context))[0];
    const orders = [];
    for (const nftId of ["emerald-ape-042", "sage-nomad-009"]) {
      await first.request(
        "POST",
        "/cart/items",
        { nftId, editionId: "ten", quantity: 1 },
        context,
      );
      const quote = await first.request("POST", "/quote", {}, context);
      orders.push(
        await first.request(
          "POST",
          "/orders",
          {
            quoteId: quote.id,
            walletId: wallet.id,
            idempotencyKey: nftId,
          },
          context,
        ),
      );
    }
    const identities: (string | undefined)[] = [];
    first.subscribe((name) => {
      if (name === "order.updated")
        identities.push(first.socketUser(context.token));
    });
    advance(1_600);
    await first.request("GET", "/session", {}, context);
    for (const order of orders)
      await expect(
        first.request("GET", `/orders/${order.id}`, {}, context),
      ).resolves.toMatchObject({
        status: "confirmed",
        version: 2,
      });
    expect(identities).toEqual(["user-collector", "user-collector"]);
  });
});

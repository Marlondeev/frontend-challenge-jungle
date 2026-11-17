import { describe, expect, it, vi } from "vitest";
import {
  createBackend,
  hashPassword,
  memoryStorage,
  STORAGE_KEY,
  type RequestContext,
} from "../../src/mocks/backend";

const visitor = (visitorId: string): RequestContext => ({ visitorId });
async function setup() {
  let time = Date.parse("2026-11-17T12:00:00Z");
  const storage = memoryStorage();
  const db = createBackend({ storage, now: () => time, schedule: false });
  const login = async (
    email = "colecionador@kurio.test",
    visitorId = "guest",
  ) => {
    const result = await db.request(
      "POST",
      "/session/login",
      { email, password: "Kurio123!" },
      visitor(visitorId),
    );
    return { token: result.token, visitorId } as RequestContext;
  };
  return {
    db,
    storage,
    login,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe("persistent marketplace backend", () => {
  it("persists the submitted collector and connection provider as an immutable receipt snapshot", async () => {
    const { db, login, storage } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const wallet = (await db.request("GET", "/wallets", {}, context))[0];
    const collector = {
      displayName: "Purchase Collector",
      username: "purchase.collector",
      email: "purchase@kurio.test",
      ens: "purchase.eth",
      note: "Keep this purchase note.",
    };
    const input = {
      quoteId: quote.id,
      walletId: wallet.id,
      idempotencyKey: "collector-snapshot",
      collector,
      provider: "Coinbase Wallet",
    };
    const order = await db.request("POST", "/orders", input, context);
    expect(order).toMatchObject({ collector, provider: "Coinbase Wallet" });
    collector.note = "Mutated local object";
    await db.request(
      "PATCH",
      "/profile",
      {
        displayName: "Later Profile",
        email: "later@kurio.test",
        ens: "later.eth",
      },
      context,
    );
    const fresh = createBackend({
      storage,
      now: () => Date.parse(order.createdAt) + 1600,
      schedule: false,
    });
    const receipt = await fresh.request(
      "GET",
      `/orders/${order.id}`,
      {},
      context,
    );
    expect(receipt.collector).toEqual({
      ...collector,
      note: "Keep this purchase note.",
    });
    expect(receipt.provider).toBe("Coinbase Wallet");
    expect(
      (
        await fresh.request(
          "GET",
          "/orders/by-key/collector-snapshot",
          {},
          context,
        )
      ).collector,
    ).toEqual(receipt.collector);
  });
  it("rejects invalid collector data before recording an order", async () => {
    const { db, login } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
    const input = {
      quoteId: quote.id,
      walletId,
      idempotencyKey: "invalid-collector",
      collector: {
        displayName: "x",
        username: "!",
        email: "invalid",
        ens: "invalid",
        note: "n".repeat(501),
      },
    };
    await expect(
      db.request("POST", "/orders", input, context),
    ).rejects.toMatchObject({
      status: 422,
      fields: {
        displayName: expect.any(String),
        username: expect.any(String),
        email: expect.any(String),
        ens: expect.any(String),
        note: expect.any(String),
      },
    });
    await expect(
      db.request("GET", "/orders/by-key/invalid-collector", {}, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      db.request(
        "POST",
        "/orders",
        {
          ...input,
          collector: {
            displayName: "Buyer",
            username: "buyer",
            email: "buyer@kurio.test",
            ens: 42,
            note: {},
          },
        },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { ens: expect.any(String), note: expect.any(String) },
    });
  });
  it("rejects a changed collector or provider for the same idempotency key", async () => {
    const { db, login } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
    const collector = {
      displayName: "Buyer",
      username: "buyer",
      email: "buyer@kurio.test",
      ens: "",
      note: "Original note",
    };
    const input = {
      quoteId: quote.id,
      walletId,
      idempotencyKey: "same-collector-intent",
      collector,
      provider: "WalletConnect",
    };
    const order = await db.request("POST", "/orders", input, context);
    expect((await db.request("POST", "/orders", input, context)).id).toBe(
      order.id,
    );
    expect(
      (
        await db.request(
          "POST",
          "/orders",
          {
            ...input,
            collector: {
              note: collector.note,
              ens: collector.ens,
              email: collector.email,
              username: collector.username,
              displayName: collector.displayName,
            },
          },
          context,
        )
      ).id,
    ).toBe(order.id);
    await expect(
      db.request(
        "POST",
        "/orders",
        { ...input, collector: { ...collector, note: "Changed note" } },
        context,
      ),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      db.request(
        "POST",
        "/orders",
        { ...input, provider: "MetaMask" },
        context,
      ),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });
  it("validates the selected connection provider and its network support", async () => {
    const { db, login } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const wallet = await db.request(
      "POST",
      "/wallets",
      {
        label: "Solana",
        network: "Solana",
        address: "11111111111111111111111111111111",
        provider: "WalletConnect",
      },
      context,
    );
    const input = {
      quoteId: quote.id,
      walletId: wallet.id,
      idempotencyKey: "unsupported-provider",
    };
    await expect(
      db.request(
        "POST",
        "/orders",
        { ...input, provider: "Unknown Wallet" },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { provider: expect.any(String) },
    });
    await expect(
      db.request(
        "POST",
        "/orders",
        { ...input, provider: "MetaMask" },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { provider: expect.any(String) },
    });
  });
  it("retains all 18 ETH decimals and rejects a negative add delta", async () => {
    const { db } = await setup();
    const context = visitor("precision");
    await db.request("POST", "/__control", {
      action: "nft-update",
      price: "0.100000000000000001",
    });
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 3 },
      context,
    );
    expect((await db.request("POST", "/quote", {}, context)).total).toBe(
      "0.316000000000000003",
    );
    await expect(
      db.request(
        "POST",
        "/cart/items",
        { nftId: "emerald-ape-042", editionId: "ten", quantity: -1 },
        context,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("stores only salted password hashes and validates registration conflicts", async () => {
    const { db, storage } = await setup();
    const input = {
      email: "new@kurio.test",
      username: "newuser",
      password: "Different123!",
      confirmPassword: "Different123!",
    };
    const auth = await db.request(
      "POST",
      "/session/register",
      input,
      visitor("register"),
    );
    expect(auth.session.user.email).toBe(input.email);
    expect(storage.getItem(STORAGE_KEY)).not.toContain(input.password);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(persisted.passwords["user-collector"].salt).not.toBe(
      persisted.passwords["user-nova"].salt,
    );
    const credentials = persisted.passwords[auth.session.user.id];
    expect(credentials.hash).toBe(
      await hashPassword(input.password, credentials.salt),
    );
    expect(await hashPassword(input.password, "another-salt")).not.toBe(
      credentials.hash,
    );
    await expect(
      db.request("POST", "/session/register", input),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("creates only one account when the same registration is submitted concurrently", async () => {
    const { db } = await setup();
    const input = {
      email: "race@kurio.test",
      username: "raceuser",
      password: "Kurio123!",
    };
    const results = await Promise.allSettled([
      db.request("POST", "/session/register", input),
      db.request("POST", "/session/register", input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 409, code: "ACCOUNT_EXISTS" } });
  });
  it("calculates ETH without floating point and applies coupon on item subtotal", async () => {
    const { db } = await setup();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 3 },
      visitor("guest"),
    );
    await db.request(
      "PUT",
      "/cart/coupon",
      { code: "KURIO10" },
      visitor("guest"),
    );
    const quote = await db.request("POST", "/quote", {}, visitor("guest"));
    expect(quote).toMatchObject({
      subtotal: "3.57",
      discount: "0.357",
      networkFee: "0.016",
      total: "3.229",
    });
  });
  it("merges guest cart at login within stock and isolates accounts and sessions", async () => {
    const { db, login } = await setup();
    const a = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 8 },
      a,
    );
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 4 },
      visitor("new-guest"),
    );
    const merged = await login("colecionador@kurio.test", "new-guest");
    expect(
      (await db.request("GET", "/cart", {}, merged)).items[0].quantity,
    ).toBe(10);
    expect(
      (await db.request("GET", "/cart", {}, visitor("new-guest"))).items,
    ).toHaveLength(0);
    const b = await login("nova@kurio.test", "other");
    expect((await db.request("GET", "/cart", {}, b)).items).toHaveLength(0);
    await db.request("POST", "/session/logout", {}, a);
    await expect(db.request("GET", "/profile", {}, a)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects nonexistent and exhausted editions and restores full fixtures on reset", async () => {
    const { db } = await setup();
    const input = {
      nftId: "emerald-ape-042",
      editionId: "missing",
      quantity: 1,
    };
    await expect(
      db.request("POST", "/cart/items", input, visitor("g")),
    ).rejects.toMatchObject({ status: 422 });
    await db.request("POST", "/__control", { action: "nft-update", stock: 0 });
    await expect(
      db.request(
        "POST",
        "/cart/items",
        { ...input, editionId: "one" },
        visitor("g"),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await db.request("POST", "/__control", { action: "reset" });
    expect((await db.request("GET", "/nfts")).total).toBeGreaterThanOrEqual(24);
    expect((await db.request("GET", "/nfts/emerald-ape-042")).price).toBe(
      "1.19",
    );
  });
  it("reuses orders for identical keys, rejects changed requests and preserves immutable receipts", async () => {
    const { db, login, advance, storage } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const wallet = (await db.request("GET", "/wallets", {}, context))[0];
    const input = {
      quoteId: quote.id,
      walletId: wallet.id,
      idempotencyKey: "stable-key",
    };
    const order = await db.request("POST", "/orders", input, context);
    expect((await db.request("POST", "/orders", input, context)).id).toBe(
      order.id,
    );
    await expect(
      db.request("POST", "/orders", { ...input, walletId: "other" }, context),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    await db.request("POST", "/__control", {
      action: "nft-update",
      price: "10",
    });
    advance(1600);
    const fresh = createBackend({
      storage,
      now: () => Date.parse(order.createdAt) + 1600,
      schedule: false,
    });
    const receipt = await fresh.request(
      "GET",
      `/orders/${order.id}`,
      {},
      context,
    );
    expect(receipt).toMatchObject({
      status: "confirmed",
      subtotal: "2.38",
      total: "2.396",
      version: 2,
    });
    expect(
      (await fresh.request("GET", "/cart", {}, context)).items,
    ).toHaveLength(0);
  });
  it("rejects stale or expired quotes before creating an order", async () => {
    const { db, login, advance } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "one", quantity: 1 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context);
    const walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
    await db.request("POST", "/__control", {
      action: "nft-update",
      price: "2",
    });
    await expect(
      db.request(
        "POST",
        "/orders",
        { quoteId: quote.id, walletId, idempotencyKey: "stale" },
        context,
      ),
    ).rejects.toMatchObject({ code: "QUOTE_CHANGED", status: 409 });
    const updated = await db.request(
      "POST",
      "/quote",
      { quoteId: quote.id },
      context,
    );
    expect(updated.changed).toBe(true);
    advance(300001);
    await expect(
      db.request(
        "POST",
        "/orders",
        { quoteId: updated.id, walletId, idempotencyKey: "expired" },
        context,
      ),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED", status: 409 });
  });
  it("isolates favorites, wallets, quotes, orders and profile mutations by authenticated owner", async () => {
    const { db, login } = await setup();
    const a = await login(),
      b = await login("nova@kurio.test", "nova");
    const aWallet = (await db.request("GET", "/wallets", {}, a))[0];
    await db.request("POST", "/favorites/emerald-ape-042", {}, a);
    expect(await db.request("GET", "/favorites", {}, b)).toEqual([]);
    await expect(
      db.request("GET", "/wallets", {}, visitor("unauthenticated")),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      db.request(
        "PATCH",
        `/wallets/${aWallet.id}`,
        { ...aWallet, label: "Stolen" },
        b,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "one", quantity: 1 },
      a,
    );
    const quote = await db.request("POST", "/quote", {}, a);
    await expect(
      db.request(
        "POST",
        "/orders",
        { quoteId: quote.id, walletId: aWallet.id, idempotencyKey: "foreign" },
        b,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const order = await db.request(
      "POST",
      "/orders",
      { quoteId: quote.id, walletId: aWallet.id, idempotencyKey: "owned" },
      a,
    );
    await expect(
      db.request("GET", `/orders/${order.id}`, {}, b),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      db.request("GET", "/orders/by-key/owned", {}, b),
    ).rejects.toMatchObject({ status: 404 });
    await db.request(
      "PATCH",
      "/profile",
      { id: "user-nova", displayName: "Meu novo nome" },
      a,
    );
    expect((await db.request("GET", "/profile", {}, b)).displayName).toBe(
      "Nova Colecionadora",
    );
    expect((await db.request("GET", "/profile", {}, a)).id).toBe(
      "user-collector",
    );
  });
  it("keeps declined orders terminal and retains their cart without reducing stock", async () => {
    const { db, login, advance } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      context,
    );
    await db.request("POST", "/__control", {
      action: "scenario",
      scenario: "payment-declined",
    });
    const quote = await db.request("POST", "/quote", {}, context),
      walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
    const input = { quoteId: quote.id, walletId, idempotencyKey: "declined" },
      order = await db.request("POST", "/orders", input, context);
    advance(1600);
    const declined = await db.request(
      "GET",
      `/orders/${order.id}`,
      {},
      context,
    );
    expect(declined).toMatchObject({
      status: "declined",
      version: 2,
      declineReason: expect.any(String),
    });
    expect(
      (await db.request("GET", "/cart", {}, context)).items[0].quantity,
    ).toBe(2);
    expect(
      (await db.request("GET", "/nfts/emerald-ape-042")).editions.find(
        (ed: { id: string }) => ed.id === "ten",
      ).stock,
    ).toBe(10);
    await db.request("POST", "/__control", {
      action: "scenario",
      scenario: "success",
    });
    advance(10000);
    expect(await db.request("POST", "/orders", input, context)).toEqual(
      declined,
    );
  });
  it("rearms an order timer that wakes before its persisted deadline", async () => {
    vi.useFakeTimers();
    let time = Date.parse("2026-11-17T12:00:00Z");
    const db = createBackend({ storage: memoryStorage(), now: () => time });
    try {
      const auth = await db.request("POST", "/session/login", {
        email: "colecionador@kurio.test",
        password: "Kurio123!",
      });
      const context = { token: auth.token };
      await db.request(
        "POST",
        "/cart/items",
        { nftId: "emerald-ape-042", editionId: "one", quantity: 1 },
        context,
      );
      const quote = await db.request("POST", "/quote", {}, context),
        walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
      const events: string[] = [];
      db.subscribe((name, event) => {
        if (name === "order.updated" && "status" in event.payload)
          events.push(event.payload.status);
      });
      await db.request(
        "POST",
        "/orders",
        { quoteId: quote.id, walletId, idempotencyKey: "timer" },
        context,
      );
      time += 1499;
      await vi.advanceTimersByTimeAsync(1500);
      expect(events).toEqual(["pending"]);
      time += 1;
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(["pending", "confirmed"]);
    } finally {
      db.dispose();
      vi.useRealTimers();
    }
  });
  it("removes only purchased quantities and leaves other or subsequently added items", async () => {
    const { db, login, advance } = await setup();
    const context = await login();
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 2 },
      context,
    );
    const quote = await db.request("POST", "/quote", {}, context),
      walletId = (await db.request("GET", "/wallets", {}, context))[0].id;
    await db.request(
      "POST",
      "/orders",
      { quoteId: quote.id, walletId, idempotencyKey: "subset" },
      context,
    );
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "emerald-ape-042", editionId: "ten", quantity: 1 },
      context,
    );
    await db.request(
      "POST",
      "/cart/items",
      { nftId: "sage-nomad-009", editionId: "one", quantity: 1 },
      context,
    );
    advance(1600);
    const cart = await db.request("GET", "/cart", {}, context);
    expect(cart.items).toHaveLength(2);
    expect(
      cart.items.map((item: { quantity: number }) => item.quantity),
    ).toEqual([1, 1]);
  });
  it("validates password updates and makes old credentials unusable", async () => {
    const { db, login } = await setup();
    const context = await login();
    await expect(
      db.request(
        "PATCH",
        "/profile/password",
        { currentPassword: "wrong", newPassword: "Changed123!" },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { currentPassword: expect.any(String) },
    });
    await db.request(
      "PATCH",
      "/profile/password",
      {
        currentPassword: "Kurio123!",
        newPassword: "Changed123!",
        confirmPassword: "Changed123!",
      },
      context,
    );
    await expect(login()).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await db.request("POST", "/session/login", {
          email: "colecionador@kurio.test",
          password: "Changed123!",
        })
      ).session.user.id,
    ).toBe("user-collector");
  });
  it("commits one consistent password when concurrent changes finish out of order", async () => {
    const { db, storage, login } = await setup();
    const context = await login();
    const previous = JSON.parse(storage.getItem(STORAGE_KEY)!).passwords[
      "user-collector"
    ];
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let releaseValidation!: () => void, releaseFirstHash!: () => void;
    const bothValidated = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const firstHashCanFinish = new Promise<void>((resolve) => {
      releaseFirstHash = resolve;
    });
    let validations = 0,
      newHashes = 0;
    const spy = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockImplementation(async (...args) => {
        const result = await deriveBits(...args);
        const salt = new TextDecoder().decode((args[0] as Pbkdf2Params).salt);
        if (salt === previous.salt) {
          validations++;
          if (validations === 2) releaseValidation();
          await bothValidated;
        } else if (++newHashes === 1) await firstHashCanFinish;
        return result;
      });
    const passwords = ["FirstChanged123!", "SecondChanged123!"];
    let results: PromiseSettledResult<unknown>[];
    try {
      // Both requests validate the same original credential. The first new hash
      // cannot finish until the other request has committed or rejected.
      results = await Promise.allSettled(
        passwords.map((newPassword) =>
          db
            .request(
              "PATCH",
              "/profile/password",
              { currentPassword: "Kurio123!", newPassword },
              context,
            )
            .finally(releaseFirstHash),
        ),
      );
    } finally {
      releaseValidation();
      releaseFirstHash();
      spy.mockRestore();
    }
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 409, code: "PASSWORD_CHANGED" } });
    const winner =
      passwords[results.findIndex((result) => result.status === "fulfilled")];
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!).passwords[
      "user-collector"
    ];
    expect(persisted.hash).toBe(await hashPassword(winner, persisted.salt));
    const refreshed = createBackend({
      storage,
      now: () => Date.parse("2026-11-17T12:00:00Z"),
      schedule: false,
    });
    expect(
      (
        await refreshed.request("POST", "/session/login", {
          email: "colecionador@kurio.test",
          password: winner,
        })
      ).session.user.id,
    ).toBe("user-collector");
    await expect(
      refreshed.request("POST", "/session/login", {
        email: "colecionador@kurio.test",
        password: "Kurio123!",
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      refreshed.request("POST", "/session/login", {
        email: "colecionador@kurio.test",
        password: passwords.find((password) => password !== winner),
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("persists avatar removal while retaining invalid MIME and size validation", async () => {
    const { db, storage, login } = await setup();
    const context = await login();
    const avatar = "data:image/png;base64,aGVsbG8=";
    expect(
      (await db.request("PATCH", "/profile", { avatar }, context)).avatar,
    ).toBe(avatar);
    await expect(
      db.request(
        "PATCH",
        "/profile",
        { avatar: "data:image/svg+xml;base64,aGVsbG8=" },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { avatar: expect.any(String) },
    });
    await expect(
      db.request(
        "PATCH",
        "/profile",
        { avatar: `data:image/png;base64,${"A".repeat(2800001)}` },
        context,
      ),
    ).rejects.toMatchObject({
      status: 422,
      fields: { avatar: expect.any(String) },
    });
    expect((await db.request("GET", "/profile", {}, context)).avatar).toBe(
      avatar,
    );
    expect(
      (await db.request("PATCH", "/profile", { avatar: "" }, context)).avatar,
    ).toBe("");
    const refreshed = createBackend({
      storage,
      now: () => Date.parse("2026-11-17T12:00:00Z"),
      schedule: false,
    });
    expect(
      (await refreshed.request("GET", "/profile", {}, context)).avatar,
    ).toBe("");
    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).users.find(
        (user: { id: string }) => user.id === "user-collector",
      ).avatar,
    ).toBe("");
  });
  it("emits stable duplicate and stale envelopes without mutating current state", async () => {
    const { db } = await setup();
    const events: Array<{
      version: number;
      eventId: string;
      payload: { version: number; price?: string };
    }> = [];
    db.subscribe((_name, event) => events.push(event));
    await db.request("POST", "/__control", {
      action: "nft-update",
      price: "2",
    });
    await db.request("POST", "/__control", { action: "duplicate" });
    await db.request("POST", "/__control", { action: "stale" });
    expect(events[1]).toEqual(events[0]);
    expect(events[2].version).toBeLessThan(events[0].version);
    expect(events[2]).toMatchObject({
      eventId: "nft.updated:emerald-ape-042:1",
      payload: { price: "1.19", version: 1 },
    });
    expect((await db.request("GET", "/nfts/emerald-ape-042")).price).toBe("2");
  });
});

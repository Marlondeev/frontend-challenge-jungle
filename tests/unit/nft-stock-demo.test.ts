import { describe, expect, it } from "vitest";
import type { Nft } from "../../src/domain/types";
import {
  createBackend,
  memoryStorage,
  STORAGE_KEY,
} from "../../src/mocks/backend";

describe("demo NFT edition defaults", () => {
  it("enriches old saved NFTs without replenishing purchased stock or changing account data", async () => {
    let time = Date.parse("2026-11-17T12:00:00Z");
    const storage = memoryStorage();
    const backend = createBackend({
      storage,
      now: () => time,
      schedule: false,
    });
    const auth = await backend.request(
      "POST",
      "/session/register",
      {
        email: "stock-demo@kurio.test",
        username: "stock.demo",
        password: "Kurio123!",
      },
      { visitorId: "stock-demo" },
    );
    const context = { token: auth.token, visitorId: "stock-demo" };
    await backend.request(
      "POST",
      "/cart/items",
      {
        nftId: "emerald-ape-042",
        editionId: "ten",
        quantity: 2,
      },
      context,
    );
    const quote = await backend.request("POST", "/quote", {}, context);
    const wallets = await backend.request("GET", "/wallets", {}, context);
    const order = await backend.request(
      "POST",
      "/orders",
      {
        quoteId: quote.id,
        walletId: wallets[0].id,
        idempotencyKey: "stock-demo-order",
      },
      context,
    );
    time += 1600;
    await backend.request("GET", `/orders/${order.id}`, {}, context);
    await backend.request(
      "POST",
      "/cart/items",
      {
        nftId: "sage-nomad-009",
        editionId: "fifty",
        quantity: 3,
      },
      context,
    );

    const previous = JSON.parse(storage.getItem(STORAGE_KEY)!);
    for (const nft of previous.nfts) delete nft.defaultEditionId;
    previous.nfts.find(
      (nft: Nft) => nft.id === "sage-nomad-009",
    ).defaultEditionId = "fifty";
    storage.setItem(STORAGE_KEY, JSON.stringify(previous));
    const expected = structuredClone(previous);
    expected.nfts.find(
      (nft: Nft) => nft.id === "emerald-ape-042",
    ).defaultEditionId = "ten";
    expected.nfts.find(
      (nft: Nft) => nft.id === "neon-vessel-552",
    ).defaultEditionId = "ten";

    const restored = createBackend({
      storage,
      now: () => time,
      schedule: false,
    });
    const emerald = await restored.request("GET", "/nfts/emerald-ape-042");
    expect(emerald).toMatchObject({ defaultEditionId: "ten" });
    expect(
      emerald.editions.find((edition: { id: string }) => edition.id === "ten")
        .stock,
    ).toBe(8);
    expect(
      emerald.editions.find((edition: { id: string }) => edition.id === "one")
        .stock,
    ).toBe(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(expected);
    restored.dispose();
    backend.dispose();
  });
});

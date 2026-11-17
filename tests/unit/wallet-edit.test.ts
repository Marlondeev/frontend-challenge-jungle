import { describe, expect, it } from "vitest";
import { createBackend, memoryStorage } from "../../src/mocks/backend";

describe("wallet optional-field editing", () => {
  it("persists an explicitly cleared ENS after reconstructing the backend", async () => {
    const storage = memoryStorage();
    const backend = createBackend({ storage, schedule: false });
    const visitorId = "wallet-edit-regression";
    const auth = await backend.request(
      "POST",
      "/session/login",
      { email: "colecionador@kurio.test", password: "Kurio123!" },
      { visitorId },
    );
    const context = { visitorId, token: auth.token };
    const [wallet] = await backend.request("GET", "/wallets", {}, context);
    expect(wallet.ens).toBeTruthy();

    const updated = await backend.request(
      "PATCH",
      `/wallets/${wallet.id}`,
      { ...wallet, ens: "" },
      context,
    );
    expect(updated.ens).toBe("");

    const restored = createBackend({ storage, schedule: false });
    const wallets = await restored.request("GET", "/wallets", {}, context);
    expect(wallets.find((item: { id: string }) => item.id === wallet.id)?.ens).toBe(
      "",
    );
  });

  it("retains the current ENS when the optional field is omitted from a patch", async () => {
    const backend = createBackend({ storage: memoryStorage(), schedule: false });
    const auth = await backend.request(
      "POST",
      "/session/login",
      { email: "colecionador@kurio.test", password: "Kurio123!" },
      { visitorId: "wallet-ens-omitted" },
    );
    const context = { visitorId: "wallet-ens-omitted", token: auth.token };
    const [wallet] = await backend.request("GET", "/wallets", {}, context);
    const { ens: previousEns, ...draft } = wallet;
    const updated = await backend.request(
      "PATCH",
      `/wallets/${wallet.id}`,
      draft,
      context,
    );
    expect(updated.ens).toBe(previousEns);
    const wallets = await backend.request("GET", "/wallets", {}, context);
    expect(wallets.find((item: { id: string }) => item.id === wallet.id)?.ens).toBe(
      previousEns,
    );
  });
});

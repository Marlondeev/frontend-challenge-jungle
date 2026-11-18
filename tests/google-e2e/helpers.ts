import { createHash } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import type { GoogleIdentity } from "../../src/domain/types";

interface StubConfiguration {
  nonce: string;
  callback(response: { credential: string }): void;
}
interface GoogleStub {
  hold: boolean;
  invalidNext: boolean;
  attempts: StubConfiguration[];
  deliver(index: number): void;
}
type StubWindow = Window & { __googleE2E: GoogleStub };

export const test = base.extend<{ identity: GoogleIdentity }>({
  identity: async ({ baseURL }, use, info) => {
    const key = createHash("sha256")
      .update(`${baseURL}:${info.project.name}:${info.title}:${info.retry}`)
      .digest("hex")
      .slice(0, 16);
    await use({
      sub: `google-e2e-${key}`,
      email: `${key}@google-e2e.test`,
      name: "Google E2E Collector",
      emailVerified: true,
    });
  },
  page: async ({ page, identity }, use) => {
    await page.addInitScript((identity) => {
      let configuration: StubConfiguration;
      const stub: GoogleStub = {
        hold: false,
        invalidNext: false,
        attempts: [],
        deliver(index) {
          const attempt = stub.attempts[index];
          if (!attempt) throw new Error("Google attempt not found");
          const payload = btoa(
            JSON.stringify({ ...identity, nonce: attempt.nonce }),
          )
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/, "");
          const credential = stub.invalidNext
            ? "invalid-test-credential"
            : `google-e2e.${payload}`;
          stub.invalidNext = false;
          attempt.callback({ credential });
        },
      };
      Object.assign(window, {
        __googleE2E: stub,
        google: {
          accounts: {
            id: {
              initialize(next: StubConfiguration) {
                configuration = next;
              },
              renderButton(
                host: HTMLElement,
                options: { click_listener(): void },
              ) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = "Continuar com Google";
                button.setAttribute("data-google-sdk-stub", "true");
                button.addEventListener("click", () => {
                  // The production SDK reserves authentication before returning a credential.
                  options.click_listener();
                  const index = stub.attempts.push(configuration) - 1;
                  if (!stub.hold) queueMicrotask(() => stub.deliver(index));
                });
                host.append(button);
              },
              cancel() {},
            },
          },
        },
      });
    }, identity);
    await page.route("https://accounts.google.com/gsi/**", (route) =>
      route.abort(),
    );
    await use(page);
  },
});
export { expect };

export async function rest<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const token = localStorage.getItem("kurio.session");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Visitor-Id": localStorage.getItem("kurio.visitor") ?? "",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
  expect(
    result.status,
    `${method} ${path}: ${JSON.stringify(result.body)}`,
  ).toBeLessThan(400);
  return result.body as T;
}

export async function googleLogin(page: Page, redirect = "/account") {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await googleButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${redirect}$`));
}

export const googleButton = (page: Page) =>
  page.locator("[data-google-sdk-stub]");
export const holdGoogle = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as StubWindow).__googleE2E.hold = true;
  });
export const rejectNextGoogle = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as StubWindow).__googleE2E.invalidNext = true;
  });
export const deliverGoogle = (page: Page, index: number) =>
  page.evaluate((index) => {
    (window as unknown as StubWindow).__googleE2E.deliver(index);
  }, index);

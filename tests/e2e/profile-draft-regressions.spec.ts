import { test, expect, login, logout, rest, control } from "./helpers";
import type { User } from "../../src/domain/types";

const avatar = {
  name: "draft-avatar.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
    "base64",
  ),
};

test("avatar updates preserve unsaved profile fields and profile save applies server normalization", async ({
  page,
}) => {
  await login(page);
  const original = await rest<User>(page, "/profile");
  const draft = {
    displayName: "  Rascunho preservado  ",
    username: "rascunho.e2e",
    email: "RASCUNHO@KURIO.TEST",
    walletAlias: "  Carteira do rascunho  ",
    ens: "  rascunho.eth  ",
  };
  for (const [key, value] of Object.entries(draft))
    await page.locator(`#profile-${key}`).fill(value);

  await page.locator("#profile-avatar").setInputFiles(avatar);
  await expect(
    page.getByRole("status").filter({ hasText: "Avatar atualizado." }),
  ).toBeVisible();
  for (const [key, value] of Object.entries(draft))
    await expect(page.locator(`#profile-${key}`)).toHaveValue(value);
  expect((await rest<User>(page, "/profile")).displayName).toBe(
    original.displayName,
  );

  await page.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(page.getByRole("img", { name: "Seu avatar" })).toHaveCount(0);
  for (const [key, value] of Object.entries(draft))
    await expect(page.locator(`#profile-${key}`)).toHaveValue(value);

  await page
    .getByRole("button", { name: "Salvar perfil", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Perfil salvo." }),
  ).toBeVisible();
  const saved = await rest<User>(page, "/profile");
  expect(saved.displayName).toBe(draft.displayName.trim());
  expect(saved.email).toBe(draft.email.toLowerCase());
  for (const key of Object.keys(draft) as (keyof typeof draft)[])
    await expect(page.locator(`#profile-${key}`)).toHaveValue(saved[key]);

  await logout(page);
  await login(page, "nova@kurio.test");
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await expect(page.locator("#profile-displayName")).not.toHaveValue(
    draft.displayName.trim(),
  );
});

test("text entered while a profile save is pending remains an unsaved draft", async ({
  page,
}) => {
  await login(page);
  const original = await rest<User>(page, "/profile");
  await page.locator("#profile-displayName").fill("Nome enviado");
  await page.locator("#profile-walletAlias").fill("Apelido enviado");
  await control(page, { action: "scenario", scenario: "slow" });
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === "/api/profile",
  );
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === "/api/profile",
  );
  await page
    .getByRole("button", { name: "Salvar perfil", exact: true })
    .click();
  await submitted;
  await page.locator("#profile-displayName").fill("Nome digitado depois");
  await page.locator("#profile-walletAlias").fill(original.walletAlias);
  await control(page, { action: "scenario", scenario: "success" });
  expect((await completed).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Perfil salvo." }),
  ).toBeVisible();
  await expect(page.locator("#profile-displayName")).toHaveValue(
    "Nome digitado depois",
  );
  await expect(page.locator("#profile-walletAlias")).toHaveValue(
    original.walletAlias,
  );
  expect((await rest<User>(page, "/profile")).displayName).toBe("Nome enviado");
  await page
    .getByRole("button", { name: "Salvar perfil", exact: true })
    .click();
  await expect
    .poll(async () => (await rest<User>(page, "/profile")).displayName)
    .toBe("Nome digitado depois");
});

test("a previous account's delayed avatar read cannot update the next account", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.evaluate(() => {
    const target = window as Window & {
      releaseAvatarRead?: () => void;
      avatarReadFinished?: boolean;
    };
    const nativeRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (
      this: FileReader,
      file: Blob,
    ) {
      target.releaseAvatarRead = () => {
        this.addEventListener(
          "loadend",
          () => {
            target.avatarReadFinished = true;
          },
          { once: true },
        );
        nativeRead.call(this, file);
      };
    };
  });
  let profileWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === "/api/profile"
    )
      profileWrites++;
  });
  await page.locator("#profile-avatar").setInputFiles(avatar);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("link", {
      name: testInfo.project.name === "mobile-chromium" ? "Conta" : "Entrar",
      exact: true,
    })
    .click();
  await page.locator("#auth-email").fill("nova@kurio.test");
  await page.locator("#auth-password").fill("Kurio123!");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#profile-email")).toHaveValue("nova@kurio.test");
  await page.evaluate(() => {
    const target = window as Window & { releaseAvatarRead?: () => void };
    if (!target.releaseAvatarRead)
      throw new Error("Missing deferred avatar read");
    target.releaseAvatarRead();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as Window & { avatarReadFinished?: boolean })
            .avatarReadFinished,
      ),
    )
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect((await rest<User>(page, "/profile")).avatar).toBeUndefined();
  expect(profileWrites).toBe(0);
});

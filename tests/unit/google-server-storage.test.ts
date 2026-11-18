import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStorage } from "../../server/file-storage";

const directories: string[] = [];
const disposers: (() => void)[] = [];
function directory() {
  const parent = resolve("tmp");
  mkdirSync(parent, { recursive: true });
  const path = mkdtempSync(resolve(parent, "google-server-unit-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(`${resolve("tmp")}${sep}`))
      throw new Error("Unsafe test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});
describe("private persistent server state", () => {
  it("persists atomically across restart and permits only one live writer", () => {
    const path = directory();
    const first = createFileStorage(path);
    disposers.push(first.dispose);
    first.storage.setItem("db", "private value");
    expect(() => createFileStorage(path)).toThrow(/outro|uso|writer|running/i);
    expect(
      JSON.parse(readFileSync(resolve(path, "state.json"), "utf8")),
    ).toEqual({ db: "private value" });
    first.dispose();
    const restarted = createFileStorage(path);
    disposers.push(restarted.dispose);
    expect(restarted.storage.getItem("db")).toBe("private value");
    restarted.storage.setItem("other", "new");
    expect(restarted.storage.getItem("db")).toBe("private value");
  });
  it("fails closed on malformed persisted data without leaving a live lock", () => {
    const path = directory();
    const state = resolve(path, "state.json");
    writeFileSync(state, "corrupted");
    expect(() => createFileStorage(path)).toThrow();
    expect(readFileSync(state, "utf8")).toBe("corrupted");
    writeFileSync(state, "{}");
    const repaired = createFileStorage(path);
    disposers.push(repaired.dispose);
  });
  it("serializes stale-lock recovery before replacing a previous writer", () => {
    const path = directory();
    writeFileSync(
      resolve(path, "writer.lock"),
      JSON.stringify({ pid: 99999999, instance: "stale" }),
    );
    writeFileSync(
      resolve(path, "recovery.lock"),
      "another recovery in progress",
    );
    expect(() => createFileStorage(path)).toThrow(/outro|uso|recupera/i);
    expect(
      JSON.parse(readFileSync(resolve(path, "writer.lock"), "utf8")).instance,
    ).toBe("stale");
    unlinkSync(resolve(path, "recovery.lock"));
    const recovered = createFileStorage(path);
    disposers.push(recovered.dispose);
    expect(existsSync(resolve(path, "recovery.lock"))).toBe(false);
    expect(() => createFileStorage(path)).toThrow(/outro|uso/i);
  });
});

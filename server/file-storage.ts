import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { StorageAdapter } from "../src/mocks/backend";

/** A private atomic file store with an exclusive process lock, never browser storage. */
export function createFileStorage(directory = "tmp/google-auth"): {
  storage: StorageAdapter;
  directory: string;
  dispose: () => void;
} {
  const absolute = resolve(directory);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const lockPath = resolve(absolute, "writer.lock");
  const recoveryPath = resolve(absolute, "recovery.lock");
  const dataPath = resolve(absolute, "state.json");
  const owner = { pid: process.pid, instance: randomUUID() };
  const encodedOwner = JSON.stringify(owner);
  function acquire() {
    try {
      return openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
      // Serialize read/check/delete recovery so a second starter cannot delete
      // the fresh writer lock installed by the first starter.
      let recovery: number;
      try {
        recovery = openSync(recoveryPath, "wx", 0o600);
      } catch (cause) {
        throw new Error(
          "Outro servidor está recuperando o armazenamento. Tente novamente.",
          { cause },
        );
      }
      try {
        if (!existsSync(lockPath)) return openSync(lockPath, "wx", 0o600);
        let previous: { pid?: number };
        try {
          previous = JSON.parse(readFileSync(lockPath, "utf8"));
        } catch (cause) {
          throw new Error(
            "O armazenamento está em uso ou possui um bloqueio inválido.",
            { cause },
          );
        }
        if (!Number.isInteger(previous.pid) || (previous.pid ?? 0) < 1)
          throw new Error("O armazenamento está em uso por outro processo.", {
            cause: error,
          });
        try {
          process.kill(previous.pid!, 0);
        } catch (failure) {
          if (
            failure &&
            typeof failure === "object" &&
            "code" in failure &&
            failure.code === "ESRCH"
          ) {
            unlinkSync(lockPath);
            return openSync(lockPath, "wx", 0o600);
          }
        }
        throw new Error(
          "O armazenamento está em uso por outro servidor. Encerre-o antes de iniciar outro.",
          { cause: error },
        );
      } finally {
        closeSync(recovery);
        unlinkSync(recoveryPath);
      }
    }
  }
  const lock = acquire();
  try {
    writeFileSync(lock, encodedOwner);
    fsyncSync(lock);
  } catch (cause) {
    unlinkSync(lockPath);
    throw cause;
  } finally {
    closeSync(lock);
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (existsSync(lockPath) && readFileSync(lockPath, "utf8") === encodedOwner)
      unlinkSync(lockPath);
  }
  function read(): Record<string, string> {
    if (disposed) throw new Error("Armazenamento encerrado.");
    if (!existsSync(dataPath)) return {};
    const value: unknown = JSON.parse(readFileSync(dataPath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((item) => typeof item !== "string")
    )
      throw new Error("O arquivo privado de dados é inválido.");
    return value as Record<string, string>;
  }
  try {
    read();
  } catch (cause) {
    dispose();
    throw cause;
  }
  return {
    directory: absolute,
    storage: {
      getItem(key) {
        return read()[key] ?? null;
      },
      setItem(key, value) {
        const state = read();
        state[key] = value;
        const temporary = resolve(absolute, `state.${owner.instance}.tmp`);
        const descriptor = openSync(temporary, "w", 0o600);
        try {
          writeFileSync(descriptor, JSON.stringify(state));
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        try {
          renameSync(temporary, dataPath);
        } catch (error) {
          if (existsSync(temporary)) unlinkSync(temporary);
          throw error;
        }
      },
    },
    dispose,
  };
}

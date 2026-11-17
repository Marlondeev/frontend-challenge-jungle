/** Only synchronous read/validate/write work belongs in a storage transaction. */
export type StorageCoordinator = <T>(operation: () => T) => Promise<T>;

const queues = new WeakMap<object, Map<string, Promise<void>>>();

/** Web Locks coordinates tabs; the adapter queue coordinates in-process backends. */
export function createStorageCoordinator(
  storage: object,
  key: string,
  locks?: Pick<LockManager, "request">,
): StorageCoordinator {
  if (locks)
    return <T>(operation: () => T) =>
      locks.request<T>(`kurio-storage:${key}`, () => operation());

  let storageQueues = queues.get(storage);
  if (!storageQueues) {
    storageQueues = new Map();
    queues.set(storage, storageQueues);
  }
  const sharedQueues = storageQueues;
  return <T>(operation: () => T) => {
    const result = (sharedQueues.get(key) ?? Promise.resolve()).then(operation);
    // A rejected request must not block later logins, recovery, or timer work.
    sharedQueues.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
}

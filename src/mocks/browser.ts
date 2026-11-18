import { setupWorker } from "msw/browser";
import type { AuthResult, GoogleIdentity } from "@/domain/types";
import {
  getClientStorage,
  getStoredVisitorId,
  isHostedGoogleDemo,
} from "@/lib/client-storage";
import { createBackend, STORAGE_KEY, type MockBackend } from "./backend";
import { createHandlers } from "./handlers";
import { createStorageCoordinator } from "./storage-coordinator";

let starting: Promise<void> | undefined;
let activeBackend: MockBackend | undefined;
/** Mocks are also deliberately enabled in the static demonstration build. */
export function startMocks(): Promise<void> {
  if (starting) return starting;
  const hostedGoogleDemo = isHostedGoogleDemo();
  const storage = getClientStorage();
  if (!storage)
    throw new Error("O armazenamento do navegador está indisponível.");
  const backend = createBackend({
    storage,
    ...(hostedGoogleDemo
      ? {}
      : {
          coordinate: createStorageCoordinator(
            storage,
            STORAGE_KEY,
            navigator.locks,
          ),
        }),
  });
  activeBackend = backend;
  const { handlers } = createHandlers(backend, { hostedGoogleDemo });
  const worker = setupWorker(...handlers);
  starting = backend.ready
    .then(() =>
      worker.start({
        serviceWorker: {
          url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
        },
        onUnhandledRequest(request, print) {
          if (new URL(request.url).pathname.startsWith("/api/")) print.error();
        },
        quiet: true,
      }),
    )
    .then(() => undefined);
  return starting;
}

/** Called only after /api/google-auth has verified the opaque Google credential. */
export async function loginVerifiedGoogleDemo(
  identity: GoogleIdentity,
  signal?: AbortSignal,
): Promise<AuthResult> {
  if (!isHostedGoogleDemo())
    throw new Error("O login verificado da demonstração não está ativo.");
  signal?.throwIfAborted();
  await startMocks();
  signal?.throwIfAborted();
  return activeBackend!.loginGoogle(identity, {
    signal,
    visitorId: getStoredVisitorId(),
  });
}

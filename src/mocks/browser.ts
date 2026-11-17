import { setupWorker } from "msw/browser";
import { createBackend } from "./backend";
import { createHandlers } from "./handlers";

let starting: Promise<void> | undefined;
/** Mocks are also deliberately enabled in the static demonstration build. */
export function startMocks(): Promise<void> {
  if (starting) return starting;
  const backend = createBackend({ storage: localStorage });
  const { handlers } = createHandlers(backend);
  const worker = setupWorker(...handlers);
  starting = worker
    .start({
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest(request, print) {
        if (new URL(request.url).pathname.startsWith("/api/")) print.error();
      },
      quiet: true,
    })
    .then(() => undefined);
  return starting;
}

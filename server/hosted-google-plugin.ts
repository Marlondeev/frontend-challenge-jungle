import type { Plugin, ViteDevServer } from "vite";
import { createHostedGoogleHandler } from "./hosted-google-auth";

/** Local dev/preview adapter for the same stateless function deployed by Vercel. */
export function hostedGooglePlugin(clientId: string): Plugin {
  const install = (server: Pick<ViteDevServer, "middlewares">) => {
    const handle = createHostedGoogleHandler({ clientId });
    server.middlewares.use((request, response, next) => {
      if (
        new URL(request.url ?? "/", "http://local").pathname !==
        "/api/google-auth"
      ) {
        next();
        return;
      }
      void handle(request, response);
    });
  };
  return {
    name: "kurio-hosted-google-auth",
    configureServer: install,
    configurePreviewServer: install,
  };
}

import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHostedGoogleHandler } from "../../server/hosted-google-auth";
import { MockError } from "../../src/mocks/backend";
import type { GoogleIdentity } from "../../src/domain/types";

const clientId = "hosted-google-e2e-client.apps.googleusercontent.com";
const credentialPrefix = "hosted-google-e2e.";

/** Test-only verifier: production configuration never imports this fixture. */
const hostedGoogleFixture: Plugin = {
  name: "hosted-google-e2e-handler",
  configureServer(server) {
    const handler = createHostedGoogleHandler({
      clientId,
      verifyGoogle: async (credential, nonce, signal) => {
        signal?.throwIfAborted();
        try {
          if (!credential.startsWith(credentialPrefix))
            throw new Error("Test credential required");
          const claims = JSON.parse(
            Buffer.from(
              credential.slice(credentialPrefix.length),
              "base64url",
            ).toString("utf8"),
          ) as GoogleIdentity & { nonce: string };
          if (
            claims.nonce !== nonce ||
            !claims.sub.startsWith("hosted-google-e2e-") ||
            !claims.email.endsWith("@hosted-google-e2e.test") ||
            claims.emailVerified !== true
          )
            throw new Error("Invalid test identity");
          return {
            sub: claims.sub,
            email: claims.email,
            name: claims.name,
            emailVerified: true,
          };
        } catch {
          throw new MockError(
            401,
            "INVALID_CREDENTIALS",
            "Não foi possível validar sua conta Google. Tente novamente.",
          );
        }
      },
    });
    server.middlewares.use((req, res, next) => {
      if (
        new URL(req.url ?? "/", "http://fixture.local").pathname !==
        "/api/google-auth"
      ) {
        next();
        return;
      }
      // The browser tests require this header to prove MSW reached Node.
      res.setHeader("X-Hosted-Google-E2E", "node-handler");
      void handler(req, res).catch(next);
    });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  cacheDir: "node_modules/.vite-hosted-google-e2e",
  plugins: [react(), tailwindcss(), hostedGoogleFixture],
  define: {
    "import.meta.env.VITE_MOCKS": JSON.stringify("true"),
    "import.meta.env.VITE_DEMO_TOOLS": JSON.stringify("false"),
    "import.meta.env.VITE_GOOGLE_LOGIN": JSON.stringify("vercel-demo"),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(clientId),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  },
});

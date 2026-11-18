import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { googleApiPlugin } from "../../server/google-api";
import { memoryStorage, MockError } from "../../src/mocks/backend";
import type { GoogleIdentity } from "../../src/domain/types";

/** Isolated test server: this verifier is never imported by the application config. */
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  cacheDir: "node_modules/.vite-google-e2e",
  plugins: [
    react(),
    tailwindcss(),
    googleApiPlugin({
      clientId: "google-e2e-client.apps.googleusercontent.com",
      storage: memoryStorage(),
      allowedOrigins: ["http://127.0.0.1:5174"],
      verifyGoogle: async (credential, nonce, signal) => {
        signal?.throwIfAborted();
        try {
          if (!credential.startsWith("google-e2e."))
            throw new Error("test token required");
          const claims = JSON.parse(
            Buffer.from(credential.slice(11), "base64url").toString("utf8"),
          ) as GoogleIdentity & { nonce: string };
          if (
            claims.nonce !== nonce ||
            !claims.sub.startsWith("google-e2e-") ||
            !claims.email.endsWith("@google-e2e.test")
          )
            throw new Error("invalid test identity");
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
    }),
  ],
  define: {
    "import.meta.env.VITE_MOCKS": JSON.stringify("false"),
    "import.meta.env.VITE_DEMO_TOOLS": JSON.stringify("false"),
    "import.meta.env.VITE_GOOGLE_LOGIN": JSON.stringify("real"),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(
      "google-e2e-client.apps.googleusercontent.com",
    ),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },
  },
});

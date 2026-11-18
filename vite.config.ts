import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { googleApiPlugin } from "./server/google-api";

export default defineConfig(({ mode }) => {
  const google = mode === "google";
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(google
        ? [
            googleApiPlugin({
              clientId: env.VITE_GOOGLE_CLIENT_ID ?? "",
              storageDirectory: fileURLToPath(
                new URL("./tmp/google-auth", import.meta.url),
              ),
              allowedOrigins: [
                "http://localhost:5173",
                "http://localhost:4173",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:4173",
              ],
            }),
          ]
        : []),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: google,
      fs: {
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/tmp/**"],
      },
      ...(google
        ? {
            headers: {
              "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
              "Referrer-Policy": "no-referrer-when-downgrade",
            },
          }
        : {}),
    },
    preview: {
      port: 4173,
      strictPort: google,
      ...(google
        ? {
            headers: {
              "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
              "Referrer-Policy": "no-referrer-when-downgrade",
            },
          }
        : {}),
    },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 600,
      outDir: google ? "dist-google" : "dist",
    },
  };
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import axios from "axios";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";
import { router } from "@/app/router";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 300_000,
      retry: (count, error) =>
        count < 1 &&
        !(
          axios.isAxiosError(error) &&
          [401, 403, 404, 409, 422].includes(error.response?.status ?? 0)
        ),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
async function bootstrap() {
  if (import.meta.env.VITE_MOCKS !== "false")
    await (await import("@/mocks/browser")).startMocks();
  const { RealtimeSync } = await import("@/lib/realtime");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <RouterProvider router={router} />
          <ToastProvider />
          <RealtimeSync />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  window.dispatchEvent(new Event("kurio:ready"));
  document.documentElement.dataset.ready = "true";
}
void bootstrap().catch((error) => {
  console.error(error);
  const root = document.getElementById("root")!;
  root.textContent =
    "Não foi possível iniciar a demonstração. Recarregue a página para tentar novamente.";
  root.setAttribute("role", "alert");
});

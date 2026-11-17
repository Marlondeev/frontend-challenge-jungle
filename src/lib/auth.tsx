import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthResult,
  LoginInput,
  RegisterInput,
  Session,
  SocialDemoProvider,
  User,
} from "@/domain/types";
import { getToken, sessionApi, setToken } from "./api";
import { notify } from "@/components/ui/toast";

const privateRoots = new Set([
  "cart",
  "quote",
  "favorites",
  "profile",
  "wallets",
  "order",
]);
export const isPrivateQuery = (query: { queryKey: readonly unknown[] }) =>
  privateRoots.has(String(query.queryKey[0]));
interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  error: unknown;
  login(input: LoginInput, signal?: AbortSignal): Promise<User>;
  loginSocialDemo(
    provider: SocialDemoProvider,
    signal?: AbortSignal,
  ): Promise<User>;
  register(input: RegisterInput, signal?: AbortSignal): Promise<User>;
  logout(): Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const generation = useRef(0);
  const pendingAuthentication = useRef<AbortController | null>(null);
  const supersede = useCallback(() => {
    const next = ++generation.current;
    pendingAuthentication.current?.abort();
    pendingAuthentication.current = null;
    return next;
  }, []);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => sessionApi.get(signal),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const clearPrivate = useCallback(async () => {
    const hashes = new Set(
      client
        .getQueryCache()
        .findAll({ predicate: isPrivateQuery })
        .map((query) => query.queryHash),
    );
    await client.cancelQueries({
      predicate: (query) => hashes.has(query.queryHash),
    });
    client.removeQueries({ predicate: (query) => hashes.has(query.queryHash) });
  }, [client]);
  const authenticate = useCallback(
    async (
      request: (signal: AbortSignal) => Promise<AuthResult>,
      signal?: AbortSignal,
    ) => {
      const version = supersede();
      const controller = new AbortController();
      pendingAuthentication.current = controller;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      const ensureCurrent = () => {
        if (controller.signal.aborted || generation.current !== version)
          throw new DOMException("Authentication canceled", "AbortError");
      };
      try {
        ensureCurrent();
        const result = await request(controller.signal);
        ensureCurrent();
        if (!result.session.user)
          throw new Error("Não foi possível recuperar sua conta.");
        await clearPrivate();
        ensureCurrent();
        // A focus/interval refetch may have started during the POST or cleanup.
        // Consume its AbortSignal before publishing the new identity atomically.
        await client.cancelQueries({ queryKey: ["session"], exact: true });
        ensureCurrent();
        setToken(result.token);
        client.setQueryData(["session"], result.session);
        return result.session.user;
      } finally {
        signal?.removeEventListener("abort", cancel);
        if (pendingAuthentication.current === controller)
          pendingAuthentication.current = null;
      }
    },
    [client, clearPrivate, supersede],
  );
  const login = useCallback(
    (input: LoginInput, signal?: AbortSignal) =>
      authenticate(
        (requestSignal) => sessionApi.login(input, requestSignal),
        signal,
      ),
    [authenticate],
  );
  const register = useCallback(
    (input: RegisterInput, signal?: AbortSignal) =>
      authenticate(
        (requestSignal) => sessionApi.register(input, requestSignal),
        signal,
      ),
    [authenticate],
  );
  const loginSocialDemo = useCallback(
    (provider: SocialDemoProvider, signal?: AbortSignal) =>
      authenticate(
        (requestSignal) => sessionApi.loginSocialDemo(provider, requestSignal),
        signal,
      ),
    [authenticate],
  );
  const logout = useCallback(async () => {
    const version = supersede();
    const token = getToken();
    await client.cancelQueries({ queryKey: ["session"], exact: true });
    try {
      await sessionApi.logout();
    } finally {
      if (generation.current === version && getToken() === token) {
        await clearPrivate();
        await client.cancelQueries({ queryKey: ["session"], exact: true });
        if (generation.current === version && getToken() === token) {
          setToken(null);
          client.setQueryData<Session>(["session"], {
            user: null,
            expiresAt: null,
          });
        }
      }
    }
  }, [client, clearPrivate, supersede]);
  useEffect(() => {
    const expire = () => {
      supersede();
      void client.cancelQueries({ queryKey: ["session"], exact: true });
      void clearPrivate();
      client.setQueryData<Session>(["session"], {
        user: null,
        expiresAt: null,
      });
      notify("Sua sessão expirou. Entre novamente para continuar.", "info");
    };
    const sync = (event: StorageEvent) => {
      if (event.key === "kurio.session") {
        supersede();
        void client.cancelQueries({ queryKey: ["session"], exact: true });
        void clearPrivate();
        void client.invalidateQueries({ queryKey: ["session"] });
      }
    };
    window.addEventListener("kurio:session-expired", expire);
    window.addEventListener("storage", sync);
    return () => {
      supersede();
      window.removeEventListener("kurio:session-expired", expire);
      window.removeEventListener("storage", sync);
    };
  }, [client, clearPrivate, supersede]);
  const value = useMemo(
    () => ({
      user: session.data?.user ?? null,
      isLoading: session.isPending,
      error: session.error,
      login,
      loginSocialDemo,
      register,
      logout,
    }),
    [
      session.data,
      session.isPending,
      session.error,
      login,
      loginSocialDemo,
      register,
      logout,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}

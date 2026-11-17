import axios from "axios";
import type {
  AuthResult,
  Cart,
  CatalogResponse,
  CatalogSearch,
  DemoControl,
  LoginInput,
  Nft,
  Order,
  PlaceOrderInput,
  Quote,
  RegisterInput,
  Session,
  SocialDemoProvider,
  User,
  Wallet,
} from "@/domain/types";

const TOKEN_KEY = "kurio.session";
const VISITOR_KEY = "kurio.visitor";
export const getToken = () =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) =>
  token
    ? localStorage.setItem(TOKEN_KEY, token)
    : localStorage.removeItem(TOKEN_KEY);
export function getVisitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}
export const api = axios.create({
  baseURL: "/api",
  timeout: 8000,
  headers: { "Content-Type": "application/json" },
});
api.interceptors.request.use((config) => {
  config.headers.set("X-Visitor-Id", getVisitorId());
  const token = getToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      getToken() &&
      error.config?.headers?.get("Authorization") === `Bearer ${getToken()}`
    ) {
      setToken(null);
      window.dispatchEvent(new Event("kurio:session-expired"));
    }
    return Promise.reject(error);
  },
);
export const catalogApi = {
  list: async (search: CatalogSearch, signal?: AbortSignal) =>
    (await api.get<CatalogResponse>("/nfts", { params: search, signal })).data,
  detail: async (id: string, signal?: AbortSignal) =>
    (await api.get<Nft>(`/nfts/${id}`, { signal })).data,
};
export const sessionApi = {
  get: async (signal?: AbortSignal) =>
    (await api.get<Session>("/session", { signal })).data,
  login: async (input: LoginInput, signal?: AbortSignal) =>
    (await api.post<AuthResult>("/session/login", input, { signal })).data,
  loginSocialDemo: async (provider: SocialDemoProvider, signal?: AbortSignal) =>
    (
      await api.post<AuthResult>(
        "/session/social-demo",
        { provider },
        { signal },
      )
    ).data,
  register: async (input: RegisterInput, signal?: AbortSignal) =>
    (await api.post<AuthResult>("/session/register", input, { signal })).data,
  logout: async () => {
    await api.post("/session/logout");
  },
};
export const cartApi = {
  get: async () => (await api.get<Cart>("/cart")).data,
  add: async (input: { nftId: string; editionId: string; quantity: number }) =>
    (await api.post<Cart>("/cart/items", input)).data,
  update: async (input: { id: string; quantity: number }) =>
    (
      await api.patch<Cart>(`/cart/items/${input.id}`, {
        quantity: input.quantity,
      })
    ).data,
  remove: async (id: string) =>
    (await api.delete<Cart>(`/cart/items/${id}`)).data,
  coupon: async (code: string | null) =>
    (await api.put<Cart>("/cart/coupon", { code })).data,
};
export const favoritesApi = {
  list: async () => (await api.get<string[]>("/favorites")).data,
  set: async ({ nftId, favorite }: { nftId: string; favorite: boolean }) =>
    favorite
      ? (await api.post<string[]>(`/favorites/${nftId}`)).data
      : (await api.delete<string[]>(`/favorites/${nftId}`)).data,
};
export const accountApi = {
  profile: async () => (await api.get<User>("/profile")).data,
  update: async (input: Partial<User>) =>
    (await api.patch<User>("/profile", input)).data,
  password: async (input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword?: string;
  }) => {
    await api.patch("/profile/password", input);
  },
  wallets: async () => (await api.get<Wallet[]>("/wallets")).data,
  saveWallet: async (input: Omit<Wallet, "id"> & { id?: string }) =>
    input.id
      ? (await api.patch<Wallet>(`/wallets/${input.id}`, input)).data
      : (await api.post<Wallet>("/wallets", input)).data,
};
export const checkoutApi = {
  quote: async (quoteId?: string) =>
    (await api.post<Quote>("/quote", { quoteId })).data,
  place: async (input: PlaceOrderInput) =>
    (
      await api.post<Order>("/orders", input, {
        headers: { "Idempotency-Key": input.idempotencyKey },
      })
    ).data,
  order: async (id: string) => (await api.get<Order>(`/orders/${id}`)).data,
  recover: async (key: string) =>
    (await api.get<Order>(`/orders/by-key/${key}`)).data,
};
export const demoApi = {
  control: async (input: DemoControl) =>
    (await api.post<Record<string, unknown>>("/__control", input)).data,
  state: async () =>
    (await api.get<{ scenario: string; connected: boolean }>("/__control"))
      .data,
};
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error))
    return (
      error.response?.data?.message ??
      (error.code === "ECONNABORTED"
        ? "A conexão demorou. Tente novamente; sua compra será recuperada com segurança."
        : "Não foi possível conectar. Verifique sua conexão e tente novamente.")
    );
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
export function fieldErrors(error: unknown): Record<string, string> {
  return axios.isAxiosError(error) ? (error.response?.data?.fields ?? {}) : {};
}

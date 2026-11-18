import type {
  ApiErrorBody,
  AuthResult,
  Cart,
  CatalogResponse,
  CatalogSearch,
  CollectorSnapshot,
  DemoControl,
  GoogleIdentity,
  Nft,
  Order,
  PlaceOrderInput,
  Provider,
  Quote,
  RealtimeEvent,
  Scenario,
  User,
  Wallet,
} from "../domain/types";
import {
  applyNftFixtureDefaults,
  nftFixtures,
  userFixtures,
  walletFixtures,
} from "./fixtures";
import {
  createStorageCoordinator,
  type StorageCoordinator,
} from "./storage-coordinator";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface RequestContext {
  token?: string;
  visitorId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export const STORAGE_KEY = "kurio.mock.v1";
export function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}
export class MockError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  toJSON(): ApiErrorBody {
    return {
      message: this.message,
      code: this.code,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
const fail = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): never => {
  throw new MockError(status, code, message, fields);
};
const clone = <T>(value: T): T => structuredClone(value);
const units = (value: string) => {
  if (!/^\d+(\.\d{1,18})?$/.test(value))
    return fail(422, "INVALID_PRICE", "Informe um valor em ETH válido.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
};
const decimal = (value: bigint) =>
  `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, "0")}`.replace(
    /\.?0+$/,
    "",
  ) || "0";
export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 10000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return [...new Uint8Array(bits)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
type Auth = { salt: string; hash: string };
type SavedQuote = Quote & { owner: string };
type StoredOrder = {
  order: Order;
  body: string;
  dueAt: number;
  decline: boolean;
};
type Event = RealtimeEvent<Nft | Order>;
type EventName = "nft.updated" | "order.updated";
type SavedEvent = { name: EventName; event: Event; userId?: string };
interface State {
  schema: 1;
  nfts: Nft[];
  users: User[];
  passwords: Record<string, Auth>;
  sessions: Record<
    string,
    { userId: string; expiresAt: number; pendingVisitorId?: string }
  >;
  carts: Record<string, Cart>;
  favorites: Record<string, string[]>;
  wallets: Record<string, Wallet[]>;
  quotes: Record<string, SavedQuote>;
  orders: Record<string, StoredOrder>;
  scenario: Scenario;
  connected: boolean;
  sequence: number;
  lastEvent?: SavedEvent;
  eventHistory: SavedEvent[];
}
function initial(): State {
  const users = userFixtures(),
    nfts = nftFixtures();
  return {
    schema: 1,
    nfts,
    users,
    passwords: {
      "user-collector": {
        salt: "kurio-fixture-v1:user-collector",
        hash: "a1117ce89bd7a16c71ab25b2ba2f0756170ae43fcfe7ce5a66dd791c8188d33e",
      },
      "user-nova": {
        salt: "kurio-fixture-v1:user-nova",
        hash: "7accda0ec0008c2b2c99d212056a9359f9384821150779c5928b8f5e3bbbb787",
      },
    },
    sessions: {},
    carts: {},
    favorites: {},
    wallets: Object.fromEntries(
      users.map((user) => [user.id, walletFixtures(user.id)]),
    ),
    quotes: {},
    orders: {},
    scenario: "success",
    connected: true,
    sequence: 0,
    eventHistory: nfts.map((item) => ({
      name: "nft.updated",
      event: {
        eventId: `nft.updated:${item.id}:${item.version}`,
        resourceId: item.id,
        version: item.version,
        payload: clone(item),
      },
    })),
  };
}
interface Options {
  storage: StorageAdapter;
  now?: () => number;
  schedule?: boolean;
  coordinate?: StorageCoordinator;
}
export function createBackend({
  storage,
  now = Date.now,
  schedule = true,
  coordinate = createStorageCoordinator(storage, STORAGE_KEY),
}: Options) {
  function load(): State {
    let loaded: State;
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
      loaded = parsed?.schema === 1 ? parsed : initial();
    } catch {
      loaded = initial();
    }
    applyNftFixtureDefaults(loaded.nfts);
    loaded.eventHistory ??= [];
    return loaded;
  }
  let state = load();
  let inTransaction = false;
  let disposed = false;
  // Reentrant event listeners read the current transaction without detaching
  // records still being mutated by settlement. Other reads never write storage.
  const view = () => (inTransaction ? state : load());
  function transaction<T>(operation: () => T): Promise<T> {
    return coordinate(() => {
      state = load();
      inTransaction = true;
      try {
        return operation();
      } finally {
        inTransaction = false;
        schedulePending();
      }
    });
  }
  const listeners = new Set<
    (name: EventName, event: Event, userId?: string) => void
  >();
  const connectionListeners = new Set<(connected: boolean) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const save = () => storage.setItem(STORAGE_KEY, JSON.stringify(state));
  const id = (prefix: string) =>
    `${prefix}-${++state.sequence}-${crypto.randomUUID().slice(0, 8)}`;
  const emit = (name: EventName, payload: Nft | Order, userId?: string) => {
    const event = {
      eventId: `${name}:${payload.id}:${payload.version}`,
      resourceId: payload.id,
      version: payload.version,
      payload: clone(payload),
    };
    state.lastEvent = { name, event, userId };
    state.eventHistory.push(clone(state.lastEvent));
    state.eventHistory = state.eventHistory.slice(-128);
    save();
    if (state.connected)
      listeners.forEach((listener) => listener(name, clone(event), userId));
  };
  const nft = (nftId: string) =>
    state.nfts.find((item) => item.id === nftId) ??
    fail(404, "NFT_NOT_FOUND", "NFT não encontrado.");
  const authenticate = (context: RequestContext, required = true) => {
    if (!context.token)
      return required
        ? fail(401, "UNAUTHORIZED", "Entre na sua conta para continuar.")
        : undefined;
    const session = state.sessions[context.token];
    if (
      !session ||
      session.expiresAt <= now() ||
      state.scenario === "expired-session"
    ) {
      delete state.sessions[context.token];
      save();
      return fail(
        401,
        "SESSION_EXPIRED",
        "Sua sessão expirou. Entre novamente.",
      );
    }
    const user =
      state.users.find((user) => user.id === session.userId) ??
      fail(401, "UNAUTHORIZED", "Sessão inválida.");
    // MSW's browser transport cannot forward the caller's AbortSignal. A demo
    // token abandoned by the UI must not consume the visitor's guest cart.
    if (session.pendingVisitorId !== undefined) {
      const visitorId = session.pendingVisitorId;
      delete session.pendingVisitorId;
      mergeGuestCart(user.id, visitorId);
    }
    return user;
  };
  const owner = (context: RequestContext) =>
    authenticate(context, false)?.id ??
    `guest:${context.visitorId ?? "anonymous"}`;
  const cartFor = (ownerId: string) =>
    state.carts[ownerId] ??
    (state.carts[ownerId] = {
      items: [],
      coupon: null,
      version: 1,
      updatedAt: new Date(now()).toISOString(),
    });
  const cartView = (cart: Cart) => ({
    ...clone(cart),
    items: cart.items.map((item) => ({
      ...clone(item),
      nft: clone(nft(item.nftId)),
    })),
  });
  const touch = (cart: Cart) => {
    cart.version++;
    cart.updatedAt = new Date(now()).toISOString();
    save();
  };
  const edition = (nftId: string, editionId: string, quantity: number) => {
    const selected =
      nft(nftId).editions.find((entry) => entry.id === editionId) ??
      fail(422, "INVALID_EDITION", "Escolha uma edição disponível.", {
        editionId: "Edição inválida.",
      });
    if (!Number.isInteger(quantity) || quantity < 1)
      fail(
        422,
        "INVALID_QUANTITY",
        "A quantidade deve ser um número inteiro positivo.",
        { quantity: "Quantidade inválida." },
      );
    if (selected.stock < quantity)
      fail(
        409,
        "OUT_OF_STOCK",
        `Há apenas ${selected.stock} unidade(s) desta edição.`,
        { quantity: "Quantidade superior ao estoque disponível." },
      );
    return selected;
  };
  const validateCoupon = (code: string | null) => {
    if (!code) return 0n;
    if (state.scenario === "expired-coupon" || code === "EXPIRED")
      return fail(422, "COUPON_EXPIRED", "Este cupom expirou.", {
        code: "Cupom expirado.",
      });
    if (
      state.scenario === "invalid-coupon" ||
      !["KURIO10", "WELCOME5"].includes(code)
    )
      return fail(422, "INVALID_COUPON", "Cupom inválido.", {
        code: "Confira o código do cupom.",
      });
    return code === "KURIO10" ? 10n : 5n;
  };
  function snapshot(ownerId: string) {
    const cart = cartFor(ownerId);
    const items = cart.items.map((item) => {
      const selected = edition(item.nftId, item.editionId, item.quantity),
        asset = nft(item.nftId);
      return {
        nftId: asset.id,
        name: asset.name,
        artwork: asset.artwork,
        editionId: selected.id,
        editionLabel: selected.label,
        quantity: item.quantity,
        unitPrice: asset.price,
        lineTotal: decimal(units(asset.price) * BigInt(item.quantity)),
      };
    });
    const subtotal = items.reduce(
        (sum, item) => sum + units(item.lineTotal),
        0n,
      ),
      discount = (subtotal * validateCoupon(cart.coupon)) / 100n;
    const networkFee = items.length ? "0.016" : "0";
    const fingerprint = JSON.stringify({
      items,
      coupon: cart.coupon,
      stocks: cart.items.map(
        (item) =>
          nft(item.nftId).editions.find((ed) => ed.id === item.editionId)
            ?.stock,
      ),
      networkFee,
    });
    return {
      items,
      subtotal: decimal(subtotal),
      discount: decimal(discount),
      networkFee,
      total: decimal(subtotal - discount + units(networkFee)),
      coupon: cart.coupon,
      fingerprint,
    };
  }
  function settle() {
    for (const record of Object.values(state.orders)) {
      const order = record.order;
      if (order.status !== "pending" || record.dueAt > now()) continue;
      const unavailable = order.items.some(
        (item) =>
          !nft(item.nftId).editions.some(
            (ed) => ed.id === item.editionId && ed.stock >= item.quantity,
          ),
      );
      order.status = record.decline || unavailable ? "declined" : "confirmed";
      order.version++;
      if (order.status === "declined")
        order.declineReason = unavailable
          ? "A edição ficou indisponível. Nenhum valor foi cobrado."
          : "Pagamento recusado pela carteira. Nenhum valor foi cobrado.";
      else {
        const cart = cartFor(order.userId);
        for (const item of order.items) {
          const asset = nft(item.nftId);
          asset.editions.find((ed) => ed.id === item.editionId)!.stock -=
            item.quantity;
          asset.version++;
          emit("nft.updated", asset);
          const row = cart.items.find(
            (entry) =>
              entry.nftId === item.nftId && entry.editionId === item.editionId,
          );
          if (row) row.quantity = Math.max(0, row.quantity - item.quantity);
        }
        cart.items = cart.items.filter((item) => item.quantity > 0);
        touch(cart);
      }
      emit("order.updated", order, order.userId);
    }
    save();
  }
  function schedulePending() {
    if (!schedule || disposed) return;
    for (const [orderId, timer] of timers)
      if (state.orders[orderId]?.order.status !== "pending") {
        clearTimeout(timer);
        timers.delete(orderId);
      }
    for (const record of Object.values(state.orders))
      if (record.order.status === "pending") {
        if (timers.has(record.order.id)) continue;
        const timer = setTimeout(
          () => {
            timers.delete(record.order.id);
            if (disposed) return;
            void transaction(() => {
              if (!disposed) settle();
              // Transaction cleanup rearms timers that wake before dueAt.
            }).catch((error: unknown) =>
              console.error("[Kurio mock timer]", error),
            );
          },
          Math.max(1, record.dueAt - now()),
        );
        timers.set(record.order.id, timer);
      }
  }
  const list = (search: CatalogSearch): CatalogResponse => {
    let items = [...state.nfts];
    const counts = (key: "category" | "network") =>
      state.nfts.reduce<Record<string, number>>((result, item) => {
        result[item[key]] = (result[item[key]] ?? 0) + 1;
        return result;
      }, {});
    if (state.scenario === "empty") items = [];
    const normalize = (text: string) =>
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (search.q)
      items = items.filter((item) =>
        normalize(`${item.name} ${item.collection}`).includes(
          normalize(search.q!),
        ),
      );
    if (search.category)
      items = items.filter((item) => item.category === search.category);
    if (search.network)
      items = items.filter((item) => item.network === search.network);
    if (search.min)
      items = items.filter((item) => units(item.price) >= units(search.min!));
    if (search.max)
      items = items.filter((item) => units(item.price) <= units(search.max!));
    if (search.tab === "new") items = items.filter((item) => item.isNew);
    if (search.tab === "trending")
      items = items.filter((item) => item.trending);
    if (search.sort === "price-asc" || search.sort === "price-desc")
      items.sort(
        (a, b) =>
          (units(a.price) < units(b.price)
            ? -1
            : units(a.price) > units(b.price)
              ? 1
              : 0) * (search.sort === "price-desc" ? -1 : 1),
      );
    else if (search.sort === "popular")
      items.sort((a, b) => b.reviews - a.reviews);
    else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Math.max(1, Math.floor(Number(search.page) || 1));
    return {
      items: clone(items.slice((page - 1) * 9, page * 9)),
      total: items.length,
      page,
      pageSize: 9,
      categories: counts("category"),
      networks: counts("network"),
    };
  };
  async function login(
    email: string,
    password: string,
    context: RequestContext,
  ) {
    const normalized = email.trim().toLowerCase();
    const snapshot = await transaction(() => {
      settle();
      const user = state.users.find((entry) => entry.email === normalized);
      if (!user || user.authProvider === "google" || !state.passwords[user.id])
        return invalidCredentials();
      return { userId: user.id, auth: { ...state.passwords[user.id] } };
    });
    const hash = await hashPassword(password, snapshot.auth.salt);
    return transaction(() => {
      const user = state.users.find(
        (entry) => entry.id === snapshot.userId && entry.email === normalized,
      );
      const current = state.passwords[snapshot.userId];
      if (
        !user ||
        hash !== snapshot.auth.hash ||
        current?.salt !== snapshot.auth.salt ||
        current?.hash !== snapshot.auth.hash
      )
        return invalidCredentials();
      return issueSession(user, context);
    });
  }
  function invalidCredentials(): never {
    return fail(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.", {
      email: "Confira suas credenciais.",
    });
  }
  /** Internal entry point; the HTTP adapter must verify the Google token first. */
  function loginGoogle(
    identity: GoogleIdentity,
    context: RequestContext = {},
  ): Promise<AuthResult> {
    return transaction(() => {
      // The request may have been canceled while waiting for the storage lock.
      context.signal?.throwIfAborted();
      const invalidIdentity = (): never =>
        fail(
          422,
          "INVALID_GOOGLE_IDENTITY",
          "Não foi possível validar os dados da conta Google.",
        );
      if (
        !identity ||
        typeof identity.sub !== "string" ||
        !identity.sub ||
        identity.sub.length > 255 ||
        /[\s\p{Cc}]/u.test(identity.sub) ||
        typeof identity.email !== "string" ||
        identity.emailVerified !== true ||
        (identity.name !== undefined && typeof identity.name !== "string") ||
        (identity.picture !== undefined && typeof identity.picture !== "string")
      )
        return invalidIdentity();
      const email = identity.email.trim().toLowerCase();
      if (
        email.length > 254 ||
        /\p{Cc}/u.test(email) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      )
        return invalidIdentity();
      let avatar: string | undefined;
      if (identity.picture) {
        try {
          const picture = new URL(identity.picture);
          if (
            identity.picture.length > 2048 ||
            picture.protocol !== "https:" ||
            picture.username ||
            picture.password
          )
            return invalidIdentity();
          avatar = picture.href;
        } catch {
          return invalidIdentity();
        }
      }
      let userId: string;
      try {
        userId = `google:${encodeURIComponent(identity.sub)}`;
      } catch {
        return invalidIdentity();
      }
      const existing = state.users.find((user) => user.id === userId);
      if (existing) {
        if (existing.authProvider !== "google")
          return fail(409, "ACCOUNT_EXISTS", "Esta conta já está cadastrada.");
        // Subject, rather than mutable email claims, binds returning accounts.
        // Keep the collector's edited profile, wallets, cart and favorites.
        return issueSession(existing, context, true);
      }
      if (state.users.some((user) => user.email.toLowerCase() === email))
        return fail(
          409,
          "ACCOUNT_EXISTS",
          "Este e-mail já está cadastrado. Entre pelo método usado no cadastro.",
          { email: "Use o método de acesso da conta existente." },
        );
      let username: string;
      do {
        username = `google_${crypto.randomUUID().slice(0, 8)}`;
      } while (
        state.users.some(
          (user) => user.username.toLowerCase() === username.toLowerCase(),
        )
      );
      const name = identity.name?.trim().slice(0, 120);
      const user: User = {
        id: userId,
        email,
        username,
        displayName: name && name.length >= 2 ? name : "Conta Google",
        walletAlias: "",
        ens: "",
        authProvider: "google",
        ...(avatar ? { avatar } : {}),
      };
      state.users.push(user);
      state.wallets[user.id] = [];
      return issueSession(user, context, true);
    });
  }
  function requireUniqueAccount(email: string, username: string) {
    if (
      state.users.some(
        (user) =>
          user.email === email ||
          user.username.toLowerCase() === username.toLowerCase(),
      )
    )
      fail(
        409,
        "ACCOUNT_EXISTS",
        "Este e-mail ou nome de usuário já está em uso.",
        { email: "E-mail ou usuário já cadastrado." },
      );
  }
  async function register(
    input: Record<string, unknown>,
    context: RequestContext,
  ) {
    const { email, username, password } = await transaction(() => {
      settle();
      const fields: Record<string, string> = {};
      const email = String(input.email ?? "")
        .trim()
        .toLowerCase();
      const username = String(input.username ?? "").trim();
      const password = String(input.password ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fields.email = "Informe um e-mail válido.";
      if (!/^[\w.-]{3,24}$/.test(username))
        fields.username = "Use de 3 a 24 letras, números, pontos ou traços.";
      if (
        password.length < 8 ||
        !/[A-Z]/.test(password) ||
        !/[0-9]/.test(password)
      )
        fields.password = "Use 8 caracteres, uma letra maiúscula e um número.";
      if (
        input.confirmPassword !== undefined &&
        input.confirmPassword !== password
      )
        fields.confirmPassword = "As senhas precisam ser iguais.";
      if (Object.keys(fields).length)
        fail(422, "VALIDATION_ERROR", "Revise os campos do cadastro.", fields);
      requireUniqueAccount(email, username);
      return { email, username, password };
    });
    const salt = crypto.randomUUID();
    const hash = await hashPassword(password, salt);
    return transaction(() => {
      requireUniqueAccount(email, username);
      const user: User = {
        id: id("user"),
        email,
        username,
        displayName: username,
        walletAlias: "",
        ens: "",
      };
      state.users.push(user);
      state.passwords[user.id] = { salt, hash };
      state.wallets[user.id] = walletFixtures(user.id);
      return issueSession(user, context);
    });
  }
  function validateMutationScenario(method: string) {
    if (
      state.scenario === "validation-error" &&
      ["POST", "PATCH", "PUT"].includes(method)
    )
      fail(422, "VALIDATION_ERROR", "Revise os campos indicados.", {
        email: "Informe um e-mail válido.",
        displayName: "Informe seu nome completo.",
        address: "Confira o endereço da carteira.",
      });
  }
  async function changePassword(
    method: string,
    input: Record<string, unknown>,
    context: RequestContext,
  ) {
    const snapshot = await transaction(() => {
      settle();
      const user = authenticate(context)!;
      validateMutationScenario(method);
      if (user.authProvider === "google" || !state.passwords[user.id])
        return fail(
          422,
          "SOCIAL_AUTH_ONLY",
          "A senha desta conta é gerenciada pelo Google.",
          { currentPassword: "Gerencie sua senha na sua conta Google." },
        );
      return { userId: user.id, auth: { ...state.passwords[user.id] } };
    });
    if (
      (await hashPassword(
        String(input.currentPassword ?? ""),
        snapshot.auth.salt,
      )) !== snapshot.auth.hash
    )
      fail(422, "INVALID_PASSWORD", "Senha atual incorreta.", {
        currentPassword: "Senha incorreta.",
      });
    const newPassword = String(input.newPassword ?? "");
    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    )
      fail(
        422,
        "WEAK_PASSWORD",
        "A nova senha deve ter 8 caracteres, uma letra maiúscula e um número.",
        {
          newPassword: "Senha muito fraca.",
        },
      );
    if (
      input.confirmPassword !== undefined &&
      input.newPassword !== input.confirmPassword
    )
      fail(422, "PASSWORD_MISMATCH", "As senhas precisam ser iguais.", {
        confirmPassword: "As senhas precisam ser iguais.",
      });
    const salt = crypto.randomUUID();
    const hash = await hashPassword(newPassword, salt);
    return transaction(() => {
      const user = authenticate(context)!;
      const current = state.passwords[snapshot.userId];
      if (
        user.id !== snapshot.userId ||
        current?.salt !== snapshot.auth.salt ||
        current?.hash !== snapshot.auth.hash
      )
        fail(
          409,
          "PASSWORD_CHANGED",
          "Sua senha foi alterada por outra solicitação. Informe a senha atual e tente novamente.",
          {
            currentPassword: "A senha foi alterada. Informe a senha atual.",
          },
        );
      state.passwords[user.id] = { salt, hash };
      save();
      return {};
    });
  }
  function socialDemo(provider: unknown, context: RequestContext) {
    if (provider !== "google" && provider !== "facebook")
      return fail(
        422,
        "INVALID_SOCIAL_PROVIDER",
        "Escolha Google ou Facebook para a demonstração.",
      );
    const fixtureId = provider === "google" ? "user-collector" : "user-nova";
    const user = state.users.find((entry) => entry.id === fixtureId);
    if (!user)
      return fail(
        503,
        "SOCIAL_DEMO_UNAVAILABLE",
        "O perfil fictício desta demonstração está indisponível. Tente novamente após restaurar os dados de teste.",
      );
    return issueSession(user, context, true);
  }
  function mergeGuestCart(userId: string, visitorId: string) {
    const source = cartFor(`guest:${visitorId}`),
      target = cartFor(userId);
    for (const item of source.items) {
      const stock =
        nft(item.nftId).editions.find((ed) => ed.id === item.editionId)
          ?.stock ?? 0;
      const row = target.items.find(
        (entry) =>
          entry.nftId === item.nftId && entry.editionId === item.editionId,
      );
      if (row) row.quantity = Math.min(stock, row.quantity + item.quantity);
      else if (stock > 0)
        target.items.push({
          ...item,
          quantity: Math.min(stock, item.quantity),
        });
    }
    target.items = target.items.filter((item) => item.quantity > 0);
    if (!target.coupon) target.coupon = source.coupon;
    source.items = [];
    source.coupon = null;
    touch(source);
    touch(target);
  }
  function issueSession(
    authenticated: User,
    context: RequestContext,
    deferGuestMerge = false,
  ): AuthResult {
    // This persistent demo condition has served its purpose once the user
    // successfully signs in again. Other failure scenarios remain selected.
    if (state.scenario === "expired-session") state.scenario = "success";
    const visitorId = context.visitorId ?? "anonymous";
    if (!deferGuestMerge) mergeGuestCart(authenticated.id, visitorId);
    const token = crypto.randomUUID(),
      expiresAt = now() + 3600000;
    state.sessions[token] = {
      userId: authenticated.id,
      expiresAt,
      ...(deferGuestMerge ? { pendingVisitorId: visitorId } : {}),
    };
    save();
    return {
      token,
      session: {
        user: clone(authenticated),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }
  function control(input: DemoControl) {
    if (input.action === "reset") {
      timers.forEach(clearTimeout);
      timers.clear();
      state = initial();
      save();
      connectionListeners.forEach((listener) => listener(true));
    }
    if (input.action === "scenario" && input.scenario) {
      state.scenario = input.scenario;
      if (input.scenario === "price-changed")
        updateNft({
          action: "nft-update",
          price: decimal(units(nft("emerald-ape-042").price) + units("0.1")),
        });
      if (input.scenario === "sold-out")
        updateNft({ action: "nft-update", stock: 0 });
    }
    if (input.action === "nft-update") updateNft(input);
    if (input.action === "disconnect" || input.action === "reconnect") {
      state.connected = input.action === "reconnect";
      connectionListeners.forEach((listener) => listener(state.connected));
    }
    if (input.action === "expire")
      Object.values(state.sessions).forEach((session) => {
        session.expiresAt = now() - 1;
      });
    if (
      (input.action === "duplicate" || input.action === "stale") &&
      state.lastEvent &&
      state.connected
    ) {
      const last = state.lastEvent;
      const replay =
        input.action === "duplicate"
          ? last
          : [...state.eventHistory]
              .reverse()
              .find(
                (entry) =>
                  entry.name === last.name &&
                  entry.event.resourceId === last.event.resourceId &&
                  entry.event.version < last.event.version,
              );
      if (replay) {
        const { name, event, userId } = clone(replay);
        listeners.forEach((listener) => listener(name, event, userId));
      }
    }
    save();
    return { scenario: state.scenario, connected: state.connected };
  }
  function updateNft(input: DemoControl) {
    const item = nft(input.nftId ?? "emerald-ape-042");
    if (input.price) {
      units(input.price);
      item.price = input.price;
    } else if (input.stock === undefined)
      item.price = decimal(units(item.price) + units("0.1"));
    if (input.stock !== undefined) {
      if (!Number.isInteger(input.stock) || input.stock < 0)
        fail(422, "INVALID_STOCK", "Estoque inválido.");
      item.editions.forEach((ed) => {
        ed.stock = input.stock!;
      });
    }
    item.version++;
    emit("nft.updated", item);
  }
  // The internal dispatcher serves heterogeneous endpoints; lib/api.ts exposes the typed public contracts.
  function dispatch(
    method: string,
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Validated heterogeneous JSON dispatcher; public contracts are typed in lib/api.ts.
    body: any = {},
    context: RequestContext = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Each route returns its public DTO; keep the transport boundary generic.
  ): any {
    if (path === "/__control")
      return method === "POST"
        ? control(body)
        : { scenario: state.scenario, connected: state.connected };
    settle();
    if (path === "/nfts") return list(body);
    if (path.startsWith("/nfts/"))
      return clone(nft(decodeURIComponent(path.slice(6))));
    if (path === "/session/social-demo" && method === "POST")
      return socialDemo(body.provider, context);
    if (path === "/session") {
      const user = authenticate(context, false);
      return {
        user: user ? clone(user) : null,
        expiresAt: user
          ? new Date(state.sessions[context.token!].expiresAt).toISOString()
          : null,
      };
    }
    if (path === "/session/logout") {
      if (context.token) delete state.sessions[context.token];
      save();
      return {};
    }
    if (path.startsWith("/cart")) {
      const cart = cartFor(owner(context));
      if (method === "GET") return cartView(cart);
      if (path === "/cart/coupon") {
        const code = body.code ? String(body.code).trim().toUpperCase() : null;
        validateCoupon(code);
        cart.coupon = code;
      } else if (path === "/cart/items" && method === "POST") {
        edition(body.nftId, body.editionId, body.quantity);
        const row = cart.items.find(
            (item) =>
              item.nftId === body.nftId && item.editionId === body.editionId,
          ),
          quantity = body.quantity + (row?.quantity ?? 0);
        edition(body.nftId, body.editionId, quantity);
        if (row) row.quantity = quantity;
        else
          cart.items.push({
            id: id("cart-item"),
            nftId: body.nftId,
            editionId: body.editionId,
            quantity,
            nft: clone(nft(body.nftId)),
          });
      } else {
        const itemId = decodeURIComponent(path.split("/").at(-1)!),
          row =
            cart.items.find((item) => item.id === itemId) ??
            fail(
              404,
              "CART_ITEM_NOT_FOUND",
              "Item não encontrado no carrinho.",
            );
        if (method === "DELETE")
          cart.items = cart.items.filter((item) => item.id !== row.id);
        else {
          edition(row.nftId, row.editionId, body.quantity);
          row.quantity = body.quantity;
        }
      }
      touch(cart);
      return cartView(cart);
    }
    if (path === "/quote" && method === "POST") {
      const ownerId = owner(context),
        values = snapshot(ownerId),
        previous = body.quoteId ? state.quotes[body.quoteId] : undefined;
      const result: SavedQuote = {
        ...values,
        id: id("quote"),
        owner: ownerId,
        version: (previous?.version ?? 0) + 1,
        expiresAt: new Date(now() + 300000).toISOString(),
        changed: !!previous && previous.fingerprint !== values.fingerprint,
      };
      state.quotes[result.id] = result;
      save();
      const { owner: _owner, ...response } = clone(result);
      return response;
    }
    const user = authenticate(context)!;
    validateMutationScenario(method);
    if (path.startsWith("/favorites")) {
      const favorites = state.favorites[user.id] ?? [];
      if (method !== "GET") {
        if (state.scenario === "favorite-error")
          fail(
            503,
            "FAVORITE_UNAVAILABLE",
            "Não foi possível salvar seu favorito. Tente novamente.",
          );
        const nftId = decodeURIComponent(path.split("/").at(-1)!);
        nft(nftId);
        state.favorites[user.id] =
          method === "POST"
            ? [...new Set([...favorites, nftId])]
            : favorites.filter((value) => value !== nftId);
        save();
      }
      return clone(state.favorites[user.id] ?? []);
    }
    if (path === "/profile") {
      if (method === "PATCH") {
        const fields: Record<string, string> = {};
        if (
          body.displayName !== undefined &&
          String(body.displayName).trim().length < 2
        )
          fields.displayName = "Informe seu nome.";
        if (
          body.email !== undefined &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
        )
          fields.email = "Informe um e-mail válido.";
        if (
          body.username !== undefined &&
          !/^[\w.-]{3,24}$/.test(body.username)
        )
          fields.username = "Nome de usuário inválido.";
        if (
          body.avatar !== undefined &&
          body.avatar !== "" &&
          (!/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/.test(
            body.avatar,
          ) ||
            body.avatar.length > 2800000)
        )
          fields.avatar = "Use PNG, JPEG ou WebP de até 2 MB.";
        if (Object.keys(fields).length)
          fail(422, "VALIDATION_ERROR", "Revise os campos indicados.", fields);
        if (
          state.users.some(
            (other) =>
              other.id !== user.id &&
              (body.email?.toLowerCase() === other.email ||
                body.username?.toLowerCase() === other.username.toLowerCase()),
          )
        )
          fail(409, "ACCOUNT_EXISTS", "E-mail ou usuário já cadastrado.", {
            email: "E-mail ou usuário já cadastrado.",
          });
        for (const key of [
          "email",
          "username",
          "displayName",
          "walletAlias",
          "ens",
          "avatar",
        ] as const)
          if (body[key] !== undefined) user[key] = String(body[key]).trim();
        user.email = user.email.toLowerCase();
        save();
      }
      return clone(user);
    }
    if (path.startsWith("/wallets")) {
      const wallets = state.wallets[user.id] ?? (state.wallets[user.id] = []);
      if (method === "GET") return clone(wallets);
      const fields: Record<string, string> = {};
      if (!String(body.label ?? "").trim())
        fields.label = "Dê um nome para a carteira.";
      if (!["Ethereum", "Polygon", "Solana"].includes(body.network))
        fields.network = "Selecione a rede.";
      if (
        !["MetaMask", "WalletConnect", "Coinbase Wallet"].includes(
          body.provider,
        )
      )
        fields.provider = "Selecione o provedor.";
      if (
        !(
          body.network === "Solana"
            ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
            : /^0x[a-fA-F0-9]{40}$/
        ).test(String(body.address ?? ""))
      )
        fields.address = "Endereço incompatível com a rede selecionada.";
      if (Object.keys(fields).length)
        fail(422, "VALIDATION_ERROR", "Revise os dados da carteira.", fields);
      const existing =
        method === "PATCH"
          ? (wallets.find((wallet) => wallet.id === path.split("/").at(-1)) ??
            fail(404, "WALLET_NOT_FOUND", "Carteira não encontrada."))
          : undefined;
      if (
        wallets.some(
          (wallet) =>
            wallet.id !== existing?.id &&
            wallet.address.toLowerCase() === body.address.toLowerCase() &&
            wallet.network === body.network,
        )
      )
        fail(409, "WALLET_EXISTS", "Esta carteira já está cadastrada.", {
          address: "Endereço já cadastrado.",
        });
      const wallet: Wallet = {
        id: existing?.id ?? id("wallet"),
        label: body.label.trim(),
        address: body.address,
        network: body.network,
        provider: body.provider,
        primary: !!body.primary,
        ...(body.ens !== undefined ? { ens: String(body.ens).trim() } : {}),
      };
      if (!wallets.length) wallet.primary = true;
      if (wallet.primary)
        wallets.forEach((entry) => {
          entry.primary = false;
        });
      if (existing) Object.assign(existing, wallet);
      else wallets.push(wallet);
      if (!wallets.some((entry) => entry.primary)) wallets[0].primary = true;
      save();
      return clone(existing ?? wallet);
    }
    if (path === "/orders" && method === "POST") {
      const input = body as PlaceOrderInput,
        key = context.idempotencyKey ?? input.idempotencyKey;
      if (!key || (context.idempotencyKey && input.idempotencyKey !== key))
        fail(
          422,
          "INVALID_IDEMPOTENCY_KEY",
          "Identificação da tentativa inválida.",
        );
      const signature = JSON.stringify({
        quoteId: input.quoteId,
        walletId: input.walletId,
        idempotencyKey: key,
        ...(input.collector !== undefined
          ? {
              collector: {
                displayName: input.collector?.displayName,
                username: input.collector?.username,
                email: input.collector?.email,
                ens: input.collector?.ens,
                note: input.collector?.note,
              },
            }
          : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
      });
      const previous = Object.values(state.orders).find(
        (record) =>
          record.order.userId === user.id &&
          record.order.idempotencyKey === key,
      );
      if (previous) {
        if (previous.body !== signature)
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Esta tentativa já foi usada com outros dados.",
          );
        return clone(previous.order);
      }
      const quote = state.quotes[input.quoteId];
      if (!quote || quote.owner !== user.id)
        fail(409, "QUOTE_INVALID", "Solicite uma nova cotação.");
      if (Date.parse(quote.expiresAt) <= now())
        fail(409, "QUOTE_EXPIRED", "A cotação expirou. Revise sua compra.");
      let current: ReturnType<typeof snapshot>;
      try {
        current = snapshot(user.id);
      } catch {
        return fail(
          409,
          "QUOTE_CHANGED",
          "A disponibilidade ou o cupom mudou. Revise sua compra.",
        );
      }
      if (quote.fingerprint !== current.fingerprint)
        fail(
          409,
          "QUOTE_CHANGED",
          "Preço, quantidade ou disponibilidade mudou. Revise sua compra.",
        );
      if (!quote.items.length)
        fail(422, "EMPTY_CART", "Seu carrinho está vazio.");
      const wallet =
        state.wallets[user.id].find((entry) => entry.id === input.walletId) ??
        fail(403, "WALLET_NOT_OWNED", "Selecione uma carteira da sua conta.");
      const submitted: unknown =
        input.collector === undefined
          ? {
              displayName: user.displayName,
              username: user.username,
              email: user.email,
              ens: user.ens,
              note: "",
            }
          : input.collector;
      const source =
        typeof submitted === "object" && submitted !== null
          ? (submitted as Record<string, unknown>)
          : {};
      const text = (key: keyof CollectorSnapshot) => {
        const value = source[key];
        return typeof value === "string" ? value.trim() : "";
      };
      const collector: CollectorSnapshot = {
        displayName: text("displayName"),
        username: text("username"),
        email: text("email").toLowerCase(),
        ens: text("ens"),
        note: text("note"),
      };
      const fields: Record<string, string> = {};
      if (collector.displayName.length < 2 || collector.displayName.length > 80)
        fields.displayName = "Use de 2 a 80 caracteres no nome de exibição.";
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(collector.username))
        fields.username = "Use de 3 a 24 letras, números, pontos ou traços.";
      if (
        collector.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collector.email)
      )
        fields.email = "Informe um e-mail válido.";
      if (
        collector.ens.length > 100 ||
        (collector.ens &&
          !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.eth$/.test(collector.ens))
      )
        fields.ens =
          "Informe um nome ENS terminado em .eth ou deixe em branco.";
      if (collector.note.length > 500)
        fields.note = "Use até 500 caracteres na observação.";
      for (const key of ["ens", "note"] as const) {
        if (source[key] !== undefined && typeof source[key] !== "string")
          fields[key] = "Informe um texto válido.";
      }
      const provider =
        input.provider === undefined ? wallet.provider : input.provider;
      if (
        !["MetaMask", "WalletConnect", "Coinbase Wallet"].includes(provider) ||
        (wallet.network === "Solana" && provider === "MetaMask")
      )
        fields.provider =
          "Selecione um provedor compatível com a rede da carteira.";
      if (Object.keys(fields).length)
        fail(422, "VALIDATION_ERROR", "Revise os dados da compra.", fields);
      const order: Order = {
        id: id("order"),
        userId: user.id,
        status: "pending",
        items: clone(quote.items),
        subtotal: quote.subtotal,
        discount: quote.discount,
        networkFee: quote.networkFee,
        total: quote.total,
        createdAt: new Date(now()).toISOString(),
        transactionId: `0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`,
        network: wallet.network,
        walletLabel: wallet.label,
        walletAddress: wallet.address,
        provider: provider as Provider,
        collector: clone(collector),
        idempotencyKey: key,
        version: 1,
      };
      state.orders[order.id] = {
        order,
        body: signature,
        dueAt: now() + 1500,
        decline: state.scenario === "payment-declined",
      };
      save();
      emit("order.updated", order, user.id);
      schedulePending();
      return clone(order);
    }
    if (path.startsWith("/orders/by-key/")) {
      const key = decodeURIComponent(path.slice("/orders/by-key/".length));
      return clone(
        Object.values(state.orders).find(
          (record) =>
            record.order.userId === user.id &&
            record.order.idempotencyKey === key,
        )?.order ?? fail(404, "ORDER_NOT_FOUND", "Pedido não encontrado."),
      );
    }
    if (path.startsWith("/orders/")) {
      const order = state.orders[decodeURIComponent(path.slice(8))]?.order;
      if (!order || order.userId !== user.id)
        fail(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
      return clone(order);
    }
    return fail(404, "NOT_FOUND", "Recurso não encontrado.");
  }
  // Bootstrap is itself coordinated: opening a tab never writes its pre-lock
  // snapshot over a login or an order committed by another tab.
  const ready = transaction(() => {
    if (!disposed) save();
  });
  async function request(
    method: string,
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- The synchronous dispatcher validates route bodies.
    body: any = {},
    context: RequestContext = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Routes expose heterogeneous public DTOs.
  ): Promise<any> {
    if (path === "/session/login" && method === "POST")
      return login(
        String(body.email ?? ""),
        String(body.password ?? ""),
        context,
      );
    if (path === "/session/register" && method === "POST")
      return register(body, context);
    if (path === "/profile/password")
      return changePassword(method, body, context);
    return transaction(() => dispatch(method, path, body, context));
  }
  return {
    ready,
    request,
    loginGoogle,
    state: () => {
      const current = view();
      return { scenario: current.scenario, connected: current.connected };
    },
    socketUser: (token?: string) => {
      const current = view();
      const session = token ? current.sessions[token] : undefined;
      if (
        !session ||
        session.expiresAt <= now() ||
        current.scenario === "expired-session"
      )
        return undefined;
      return current.users.find((user) => user.id === session.userId)?.id;
    },
    subscribe: (
      listener: (name: EventName, event: Event, userId?: string) => void,
    ) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onConnection: (listener: (connected: boolean) => void) => {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      timers.forEach(clearTimeout);
      timers.clear();
      listeners.clear();
      connectionListeners.clear();
    },
  };
}
export type MockBackend = ReturnType<typeof createBackend>;

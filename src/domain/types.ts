export type Network = "Ethereum" | "Polygon" | "Solana";
export type Artwork = "green" | "purple" | "ivory" | "gold";
export type Provider = "MetaMask" | "WalletConnect" | "Coinbase Wallet";
export type Sort = "recent" | "price-asc" | "price-desc" | "popular";
export interface Edition {
  id: string;
  label: string;
  stock: number;
}
export interface Nft {
  id: string;
  name: string;
  artwork: Artwork;
  description: string;
  collection: string;
  category: string;
  network: Network;
  price: string;
  previousPrice?: string;
  editions: Edition[];
  rarity?: string;
  rating: number;
  reviews: number;
  version: number;
  createdAt: string;
  trending: boolean;
  isNew: boolean;
}
export interface CatalogSearch {
  q?: string;
  category?: string;
  network?: Network | "";
  min?: string;
  max?: string;
  sort?: Sort;
  page?: number;
  tab?: "all" | "new" | "trending";
}
export interface CatalogResponse {
  items: Nft[];
  total: number;
  page: number;
  pageSize: number;
  categories: Record<string, number>;
  networks: Record<string, number>;
}
export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  walletAlias: string;
  ens: string;
  avatar?: string;
  referralCode?: string;
}
export interface Session {
  user: User | null;
  expiresAt: string | null;
}
export interface LoginInput {
  email: string;
  password: string;
}
export type SocialDemoProvider = "google" | "facebook";
export interface RegisterInput extends LoginInput {
  username: string;
  confirmPassword?: string;
}
export interface AuthResult {
  token: string;
  session: Session;
}
export interface Wallet {
  id: string;
  label: string;
  network: Network;
  address: string;
  provider: Provider;
  primary: boolean;
  ens?: string;
}
export interface CartItem {
  id: string;
  nftId: string;
  editionId: string;
  quantity: number;
  nft: Nft;
}
export interface Cart {
  items: CartItem[];
  coupon: string | null;
  version: number;
  updatedAt: string;
}
export interface OrderItem {
  nftId: string;
  name: string;
  artwork: Artwork;
  editionId: string;
  editionLabel: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}
export interface Quote {
  id: string;
  version: number;
  fingerprint: string;
  items: OrderItem[];
  subtotal: string;
  discount: string;
  networkFee: string;
  total: string;
  coupon: string | null;
  expiresAt: string;
  changed?: boolean;
}
export interface CollectorSnapshot {
  displayName: string;
  username: string;
  email: string;
  ens: string;
  note: string;
}
export interface Order {
  id: string;
  userId: string;
  status: "pending" | "confirmed" | "declined";
  items: OrderItem[];
  subtotal: string;
  discount: string;
  networkFee: string;
  total: string;
  createdAt: string;
  transactionId: string;
  network: Network;
  walletLabel: string;
  walletAddress: string;
  provider: Provider;
  /** Absent only on receipts saved before collector snapshots were introduced. */
  collector?: CollectorSnapshot;
  idempotencyKey: string;
  version: number;
  declineReason?: string;
}
export interface PlaceOrderInput {
  quoteId: string;
  walletId: string;
  idempotencyKey: string;
  /** Omitted by legacy clients; the server then snapshots the buyer's profile. */
  collector?: CollectorSnapshot;
  provider?: Provider;
}
export interface ApiErrorBody {
  message: string;
  code: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
}
export type Scenario =
  | "success"
  | "empty"
  | "slow"
  | "variable-latency"
  | "offline"
  | "server-error"
  | "expired-session"
  | "validation-error"
  | "invalid-coupon"
  | "expired-coupon"
  | "price-changed"
  | "sold-out"
  | "order-timeout"
  | "payment-declined"
  | "favorite-error";
export interface RealtimeEvent<T> {
  eventId: string;
  resourceId: string;
  version: number;
  payload: T;
}
export interface DemoControl {
  action:
    | "reset"
    | "scenario"
    | "nft-update"
    | "disconnect"
    | "reconnect"
    | "duplicate"
    | "stale"
    | "expire";
  scenario?: Scenario;
  nftId?: string;
  price?: string;
  stock?: number;
}

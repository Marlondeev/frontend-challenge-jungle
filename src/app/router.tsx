import { lazy, Suspense, useEffect, type ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  lazyRouteComponent,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { CatalogSearch, Network, Session, Sort } from "@/domain/types";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { Header, Footer, MobileNav } from "@/components/layout/site-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DemoTools } from "@/features/demo/demo-tools";

const CatalogPage = lazyRouteComponent(
  () => import("@/features/catalog/catalog-page"),
  "CatalogPage",
);
const FavoritesPage = lazy(() =>
  import("@/features/catalog/catalog-page").then((m) => ({
    default: m.FavoritesPage,
  })),
);
const NftPage = lazy(() =>
  import("@/features/nft/nft-page").then((m) => ({ default: m.NftPage })),
);
const AuthPage = lazy(() =>
  import("@/features/auth/auth-page").then((m) => ({ default: m.AuthPage })),
);
const CartPage = lazy(() =>
  import("@/features/cart/cart-page").then((m) => ({ default: m.CartPage })),
);
const CheckoutPage = lazy(() =>
  import("@/features/checkout/checkout-page").then((m) => ({
    default: m.CheckoutPage,
  })),
);
const OrderPage = lazy(() =>
  import("@/features/checkout/order-page").then((m) => ({
    default: m.OrderPage,
  })),
);
const ProfilePage = lazy(() =>
  import("@/features/account/profile-page").then((m) => ({
    default: m.ProfilePage,
  })),
);
const WalletsPage = lazy(() =>
  import("@/features/account/wallets-page").then((m) => ({
    default: m.WalletsPage,
  })),
);

export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-label="Carregando página">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading, error } = useAuth();
  const location = useRouterState({ select: (state) => state.location });
  const client = useQueryClient();
  const cached = client.getQueryData<Session>(["session"]);
  const currentUser = cached === undefined ? user : cached.user;
  if (isLoading && cached === undefined) return <RouteLoading />;
  const expired = axios.isAxiosError(error) && error.response?.status === 401;
  if (error && !expired)
    return (
      <div className="state-panel">
        <h1>Não foi possível recuperar sua sessão</h1>
        <p>{errorMessage(error)}</p>
        <Button
          onClick={() => client.invalidateQueries({ queryKey: ["session"] })}
        >
          Tentar novamente
        </Button>
      </div>
    );
  const privatePath =
    /^\/(?:account(?:\/|$)|checkout(?:\/|$)|order\/|favorites(?:\/|$))/.test(
      location.pathname,
    );
  if (!currentUser || expired)
    return !privatePath ? (
      <RouteLoading />
    ) : (
      <Navigate to="/login" search={{ redirect: location.href }} replace />
    );
  return children;
}
function AppLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  useEffect(() => {
    if (!document.querySelector('[role="dialog"]'))
      document.getElementById("main-content")?.focus({ preventScroll: true });
    const title =
      pathname === "/"
        ? "Arte digital para colecionar"
        : pathname.startsWith("/nft/")
          ? "Detalhes do NFT"
          : pathname === "/cart"
            ? "Carrinho de NFTs"
            : pathname === "/checkout"
              ? "Pagamento"
              : pathname.startsWith("/order/")
                ? "Seu pedido"
                : pathname === "/login"
                  ? "Entrar"
                  : pathname === "/register"
                    ? "Criar conta"
                    : pathname === "/favorites"
                      ? "Seus favoritos"
                      : "Perfil do colecionador";
    document.title = `Kurio — ${title}`;
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <Header />
      <main id="main-content" className="app-main" tabIndex={-1}>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </main>
      {!pathname.startsWith("/account") && <Footer />}
      {(pathname === "/" || pathname === "/favorites") && <MobileNav />}
      {import.meta.env.VITE_DEMO_TOOLS !== "false" && <DemoTools />}
    </>
  );
}
function NotFound() {
  return (
    <div className="state-panel">
      <h1>Página não encontrada</h1>
      <p>Esse caminho não está disponível. Continue explorando a coleção.</p>
      <Button asChild>
        <Link to="/">Explorar NFTs</Link>
      </Button>
    </div>
  );
}
const rootRoute = createRootRoute({
  component: AppLayout,
  notFoundComponent: NotFound,
  errorComponent: ({ error, reset }) => (
    <div className="state-panel" role="alert">
      <h1>Não foi possível abrir esta página</h1>
      <p>{errorMessage(error)}</p>
      <Button onClick={reset}>Tentar novamente</Button>
      <Link to="/">Voltar ao início</Link>
    </div>
  ),
});
export function validateCatalogSearch(
  raw: Record<string, unknown>,
): CatalogSearch {
  const text = (value: unknown) =>
    typeof value === "string" ? value.slice(0, 100) : undefined;
  const q = text(raw.q);
  const category = text(raw.category);
  const network = ["Ethereum", "Polygon", "Solana"].includes(
    String(raw.network),
  )
    ? (raw.network as Network)
    : undefined;
  const sort = ["recent", "price-asc", "price-desc", "popular"].includes(
    String(raw.sort),
  )
    ? (raw.sort as Sort)
    : undefined;
  const amount = (value: unknown) =>
    typeof value === "string" && /^\d+(?:\.\d{1,18})?$/.test(value)
      ? value
      : undefined;
  const page = Number(raw.page);
  return {
    q: q || undefined,
    category: category || undefined,
    network,
    sort,
    min: amount(raw.min),
    max: amount(raw.max),
    page: Number.isSafeInteger(page) && page > 0 ? page : undefined,
    tab: ["all", "new", "trending"].includes(String(raw.tab))
      ? (raw.tab as CatalogSearch["tab"])
      : undefined,
  };
}
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateCatalogSearch,
  component: CatalogPage,
});
const nftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nft/$id",
  component: () => <NftPage id={nftRoute.useParams().id} />,
});
const cartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cart",
  component: () => <CartPage />,
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checkout",
  component: () => (
    <RequireAuth>
      <CheckoutPage />
    </RequireAuth>
  ),
});
const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/order/$id",
  component: () => (
    <RequireAuth>
      <OrderPage id={orderRoute.useParams().id} />
    </RequireAuth>
  ),
});
const authSearch = (raw: Record<string, unknown>) => ({
  redirect:
    typeof raw.redirect === "string" &&
    raw.redirect.startsWith("/") &&
    !raw.redirect.startsWith("//")
      ? raw.redirect
      : undefined,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: authSearch,
  component: () => <AuthPage mode="login" />,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  validateSearch: authSearch,
  component: () => <AuthPage mode="register" />,
});
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: () => (
    <RequireAuth>
      <ProfilePage />
    </RequireAuth>
  ),
});
const walletsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/wallets",
  component: () => (
    <RequireAuth>
      <WalletsPage />
    </RequireAuth>
  ),
});
const favoritesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/favorites",
  component: () => (
    <RequireAuth>
      <FavoritesPage />
    </RequireAuth>
  ),
});
const routeTree = rootRoute.addChildren([
  homeRoute,
  nftRoute,
  cartRoute,
  checkoutRoute,
  orderRoute,
  loginRoute,
  registerRoute,
  profileRoute,
  walletsRoute,
  favoritesRoute,
]);
export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: "intent",
  defaultPendingComponent: RouteLoading,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

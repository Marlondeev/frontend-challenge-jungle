import {
  Link,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import {
  Search,
  ShoppingCart,
  LogIn,
  Heart,
  Home,
  UserRound,
  ScanLine,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import "@/styles/storefront.css";

export function Header() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const marketplaceFlow =
    /^\/(?:nft\/|cart$|checkout$|order\/|favorites$)/.test(pathname);
  const cart = useCart();
  const { user } = useAuth();
  const search = useSearch({ strict: false }) as { q?: string };
  useEffect(() => setQuery(search.q ?? ""), [search.q]);
  const count = cart.data?.items.reduce((n, item) => n + item.quantity, 0) ?? 0;
  return (
    <header className="site-header wrap">
      <Link to="/" className="brand">
        KURIO
      </Link>
      <nav aria-label="Navegação principal">
        <Link
          to="/"
          hash=""
          search={true}
          activeOptions={{
            exact: true,
            includeHash: true,
            includeSearch: false,
          }}
        >
          Início
        </Link>
        <Link
          to="/"
          hash="mercado"
          search={true}
          activeOptions={{
            exact: true,
            includeHash: true,
            includeSearch: false,
          }}
          className={marketplaceFlow ? "active" : undefined}
          aria-current={marketplaceFlow ? "page" : undefined}
        >
          Mercado
        </Link>
        <Link
          to="/"
          hash="criadores"
          search={true}
          activeOptions={{
            exact: true,
            includeHash: true,
            includeSearch: false,
          }}
        >
          Criadores
        </Link>
        <Link
          to="/"
          hash="aprenda"
          search={true}
          activeOptions={{
            exact: true,
            includeHash: true,
            includeSearch: false,
          }}
        >
          Aprenda
        </Link>
      </nav>
      <div className="header-actions">
        {open && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate({
                to: "/",
                search: { q: query, page: 1 },
                hash: "mercado",
              });
              setOpen(false);
            }}
          >
            <input
              autoFocus
              aria-label="Buscar NFTs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar NFTs"
            />
          </form>
        )}
        <button
          className="icon-button"
          aria-label="Abrir busca"
          onClick={() => setOpen(!open)}
        >
          <Search />
        </button>
        <Link
          to="/cart"
          className="cart-link"
          aria-label={`Carrinho, ${count} itens`}
        >
          <ShoppingCart />
          {count > 0 && <span>{count}</span>}
        </Link>
        <Link
          className="solid-link"
          to={user ? "/account" : "/login"}
          search={
            !user && pathname === "/cart" ? { redirect: "/cart" } : undefined
          }
        >
          <LogIn size={16} />
          {user ? "Conta" : "Entrar"}
        </Link>
      </div>
    </header>
  );
}
export function Footer() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <footer className="site-footer wrap">
      <h2 className="sr-only">Sobre a Kurio</h2>
      <div className="footer-top">
        <div>
          <b className="footer-circle">W</b>
          <h3>Segurança da carteira</h3>
          <p>
            Proteja sua carteira e colecione arte digital verificada com
            confiança.
          </p>
        </div>
        <div>
          <b className="footer-circle">C</b>
          <h3>Criadores em destaque</h3>
          <p>
            Conheça artistas, estúdios e comunidades que moldam a cultura
            digital na rede.
          </p>
        </div>
        <div>
          <b className="footer-circle">D</b>
          <h3>Alertas de lançamentos</h3>
          <p>
            Receba calendários de cunhagem, novidades de listas de acesso e
            análises do mercado.
          </p>
        </div>
        <div>
          <h3>Antecipe-se ao próximo lançamento</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
          >
            <label className="sr-only" htmlFor="newsletter">
              Seu e-mail
            </label>
            <input
              id="newsletter"
              type="email"
              required
              placeholder="digite seu e-mail..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button style={{ color: "var(--background)" }}>Enviar</button>
          </form>
          <p>
            {sent
              ? "Cadastro de newsletter indisponível nesta demonstração."
              : "Receba lançamentos selecionados, histórias de criadores e novidades do mercado."}
          </p>
        </div>
      </div>
      <div className="footer-strip">
        <b>KURIO</b>
        <span>
          Feito para colecionadores,
          <br /> criadores e cultura
        </span>
        <span>contato@email.com</span>
        <span>+55 11 4002 8922</span>
      </div>
      <div className="footer-links">
        <div>
          <h3>Meu perfil</h3>
          <Link to="/account">Meu perfil</Link>
          <Link to="/favorites">Lista de interesse</Link>
          <Link to="/cart">Meu carrinho</Link>
        </div>
        <div>
          <h3>Central de ajuda</h3>
          <a href="/#aprenda">Como comprar NFTs</a>
          <a href="/#aprenda">Carteira e segurança</a>
        </div>
        <div>
          <h3>Coleções</h3>
          <a href="/#mercado">Arte digital</a>
          <a href="/#mercado">Fotografia</a>
          <a href="/#mercado">Música</a>
          <a href="/#mercado">Arte 3D</a>
        </div>
        <div>
          <h3>Redes sociais</h3>
          <p className="social-icons">
            <span>f</span>
            <span>◎</span>
            <span>♥</span>
            <span>in</span>
            <span>▶</span>
          </p>
          <h3>Carteiras compatíveis</h3>
          <small>METAMASK · WALLETCONNECT · COINBASE</small>
        </div>
      </div>
      <p className="copyright">© 2026 Kurio. Propriedade digital para todos.</p>
    </footer>
  );
}
export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Navegação móvel">
      <Link to="/" aria-label="Início">
        <Home />
      </Link>
      <Link to="/favorites" aria-label="Favoritos">
        <Heart />
      </Link>
      <Link
        to="/"
        hash="mercado"
        search={true}
        className="mobile-nav-center"
        aria-label="Explorar NFTs"
      >
        <ScanLine />
      </Link>
      <Link to="/cart" aria-label="Carrinho">
        <ShoppingCart />
      </Link>
      <Link to="/account" aria-label="Conta">
        <UserRound />
      </Link>
    </nav>
  );
}

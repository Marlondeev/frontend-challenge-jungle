import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Heart, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Artwork, CatalogSearch, Nft } from "@/domain/types";
import { useCatalog, useFavorites, useToggleFavorite } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { catalogApi, errorMessage } from "@/lib/api";
import { formatEth } from "@/lib/money";
import { ArtworkImage } from "@/components/ui/artwork";
import { PriceRangeFilter } from "./price-range-filter";
import "@/styles/storefront.css";

export function NftCard({ nft }: { nft: Nft }) {
  const { user } = useAuth();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const navigate = useNavigate();
  const favorite = favorites.data?.includes(nft.id) ?? false;
  return (
    <article className="nft-card">
      <div className="card-image">
        <Link
          to="/nft/$id"
          params={{ id: nft.id }}
          aria-label={`Ver ${nft.name}`}
        >
          <ArtworkImage artwork={nft.artwork} alt={nft.name} size="card" />
        </Link>
        {nft.rarity && <span className="rarity">{nft.rarity}</span>}
        <button
          className="favorite"
          aria-label={
            favorite
              ? `Remover ${nft.name} dos favoritos`
              : `Favoritar ${nft.name}`
          }
          aria-pressed={favorite}
          onClick={() => {
            if (!user) {
              navigate({ to: "/login", search: { redirect: "/favorites" } });
              return;
            }
            toggle.mutate({ nftId: nft.id, favorite: !favorite });
          }}
        >
          <Heart fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <Link className="card-name" to="/nft/$id" params={{ id: nft.id }}>
        {nft.name}
      </Link>
      <div className="card-price">
        {formatEth(nft.price)} ETH{" "}
        {nft.previousPrice && <del>{formatEth(nft.previousPrice)} ETH</del>}
      </div>
    </article>
  );
}
function Filters({
  search,
  change,
  categories,
  networks,
}: {
  search: CatalogSearch;
  change: (s: Partial<CatalogSearch>) => void;
  categories: Record<string, number>;
  networks: Record<string, number>;
}) {
  const [priceReset, setPriceReset] = useState(0);
  return (
    <div className="filters">
      <h3>Coleções</h3>
      <button
        className={!search.category ? "selected" : ""}
        onClick={() => change({ category: undefined })}
      >
        Todas{" "}
        <span>{Object.values(categories).reduce((a, b) => a + b, 0)}</span>
      </button>
      {Object.entries(categories).map(([name, count]) => (
        <button
          key={name}
          className={search.category === name ? "selected" : ""}
          onClick={() =>
            change({ category: search.category === name ? undefined : name })
          }
        >
          {name}
          <span>({count})</span>
        </button>
      ))}
      <PriceRangeFilter
        key={priceReset}
        minimum={search.min}
        maximum={search.max}
        onApply={(min, max) => change({ min, max })}
      />
      <h3>Rede</h3>
      {Object.entries(networks).map(([name, count]) => (
        <button
          key={name}
          className={search.network === name ? "selected" : ""}
          onClick={() =>
            change({
              network:
                search.network === name
                  ? undefined
                  : (name as CatalogSearch["network"]),
            })
          }
        >
          {name}
          <span>({count})</span>
        </button>
      ))}
      <button
        className="clear-filters"
        onClick={() => {
          setPriceReset((value) => value + 1);
          change({
            category: undefined,
            network: undefined,
            min: undefined,
            max: undefined,
          });
        }}
      >
        Limpar filtros
      </button>
    </div>
  );
}
const editorials: { art: Artwork; title: string; copy: string }[] = [
  {
    art: "ivory",
    title: "Como funciona a propriedade de NFTs",
    copy: "Aprenda a colecionar, negociar e verificar ativos digitais.",
  },
  {
    art: "green",
    title: "10 artistas digitais para acompanhar",
    copy: "Conheça criadores que moldam a cultura digital.",
  },
  {
    art: "purple",
    title: "Raridade, atributos e procedência",
    copy: "Entenda raridade, procedência, direitos autorais e utilidade.",
  },
  {
    art: "gold",
    title: "Como proteger sua carteira",
    copy: "Proteja sua carteira, seus ativos e sua identidade.",
  },
];
const sortLabels = {
  recent: "Listados recentemente",
  "price-asc": "Menor preço",
  "price-desc": "Maior preço",
  popular: "Mais populares",
} as const;
export function CatalogPage() {
  const search = useSearch({ strict: false }) as CatalogSearch;
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const [filterOpen, setFilterOpen] = useState(false);
  const result = useCatalog(search);
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    if (q === (search.q ?? "")) return;
    const timer = setTimeout(
      () =>
        navigate({
          to: "/",
          search: (previous) => ({ ...previous, q: q || undefined, page: 1 }),
          hash: "mercado",
          resetScroll: false,
          hashScrollIntoView: false,
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [q, search.q, navigate]);
  const change = (s: Partial<CatalogSearch>) =>
    navigate({
      to: "/",
      search: { ...search, ...s, page: 1 },
      hash: "mercado",
      resetScroll: false,
      hashScrollIntoView: false,
    });
  const data = result.data;
  const pages = Math.ceil((data?.total ?? 0) / (data?.pageSize || 9));
  return (
    <div className="catalog-page wrap">
      <div className="mobile-search">
        <div>
          <Search />
          <input
            aria-label="Explorar coleções"
            placeholder="Explorar coleções"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button aria-label="Abrir filtros" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal />
        </button>
      </div>
      <section className="hero">
        <div>
          <p>Bem-vindo à Kurio</p>
          <h1>
            <span className="desktop-copy">
              SEJA DONO DO FUTURO
              <br />
              DA ARTE DIGITAL
            </span>
            <span className="mobile-copy">
              SEJA DONO DA
              <br /> CULTURA DIGITAL
            </span>
          </h1>
          <p className="hero-description">
            <span className="desktop-copy">
              Descubra NFTs selecionados de criadores emergentes e consagrados.
              Colecione arte digital rara, apoie artistas e tenha uma parte da
              cultura da internet.
            </span>
            <span className="mobile-copy">
              Descubra NFTs selecionados de criadores do mundo todo.
            </span>
          </p>
          <Link className="hero-cta" to="/" hash="mercado" search={true}>
            EXPLORAR <span>→</span>
          </Link>
        </div>
        <div className="hero-art">
          <ArtworkImage
            artwork="green"
            alt="Arte digital Emerald Ape"
            size="hero"
            sizes="(min-width: 1200px) 450px, (min-width: 768px) 40vw, calc(40vw - 32px)"
            eager
          />
          <ArtworkImage
            artwork="purple"
            alt=""
            size="thumb"
            className="hero-mini"
          />
        </div>
        <div className="hero-dots">● ● ●</div>
      </section>
      <section id="mercado" className="market">
        <h2 className="sr-only">Mercado de NFTs</h2>
        <aside>
          <Filters
            search={search}
            change={change}
            categories={data?.categories ?? {}}
            networks={data?.networks ?? {}}
          />
          <div className="featured">
            <strong>NFT EM DESTAQUE</strong>
            <b>OFERTA LIMITADA</b>
            <ArtworkImage artwork="purple" alt="NFT em destaque" size="card" />
          </div>
        </aside>
        <div className="market-content">
          <div className="market-toolbar">
            <div
              className="market-tabs"
              role="group"
              aria-label="Tipo de coleção"
            >
              {(
                [
                  ["all", "Todos os NFTs"],
                  ["new", "Novos lançamentos"],
                  ["trending", "Em alta"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={(search.tab ?? "all") === value ? "active" : ""}
                  onClick={() => change({ tab: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sort">
              <span aria-hidden="true">
                Ordenar por: {sortLabels[search.sort ?? "recent"]}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
              <select
                aria-label="Ordenar por"
                value={search.sort ?? "recent"}
                onChange={(e) =>
                  change({ sort: e.target.value as CatalogSearch["sort"] })
                }
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="result-count" aria-live="polite">
            {data
              ? `${data.total} NFTs encontrados`
              : result.isLoading
                ? "Carregando NFTs..."
                : ""}
          </p>
          {result.isError ? (
            <div className="state-box" role="alert">
              <p>{errorMessage(result.error)}</p>
              <button onClick={() => result.refetch()}>Tentar novamente</button>
            </div>
          ) : result.isLoading ? (
            <div className="nft-grid">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="card-skeleton" />
              ))}
            </div>
          ) : data?.items.length ? (
            <div className="nft-grid">
              {data.items.map((nft) => (
                <NftCard key={nft.id} nft={nft} />
              ))}
            </div>
          ) : (
            <div className="state-box">
              Nenhum NFT encontrado. Experimente alterar os filtros.
            </div>
          )}
          {pages > 1 && (
            <nav className="pagination" aria-label="Paginação">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  aria-current={
                    (search.page ?? 1) === i + 1 ? "page" : undefined
                  }
                  onClick={() =>
                    navigate({
                      to: "/",
                      search: { ...search, page: i + 1 },
                      hash: "mercado",
                    })
                  }
                >
                  {i + 1}
                </button>
              ))}
            </nav>
          )}
        </div>
      </section>
      <Dialog.Root open={filterOpen} onOpenChange={setFilterOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="filter-overlay" />
          <Dialog.Content className="filter-dialog">
            <Dialog.Close className="filter-close" aria-label="Fechar filtros">
              <X />
            </Dialog.Close>
            <Dialog.Title>Filtros</Dialog.Title>
            <Dialog.Description>
              Refine os NFTs por coleção, preço e rede.
            </Dialog.Description>
            <Filters
              search={search}
              change={change}
              categories={data?.categories ?? {}}
              networks={data?.networks ?? {}}
            />
            <Dialog.Close className="solid-link">Ver resultados</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <section className="promos" id="criadores">
        <h2 className="sr-only">Descubra coleções e criadores</h2>
        {[
          {
            art: "green" as Artwork,
            title: "Lançamentos gênesis de edição limitada",
            copy: "Colecione edições escassas diretamente dos criadores antes da revelação pública.",
          },
          {
            art: "ivory" as Artwork,
            title: "Arte digital selecionada e muito mais",
            copy: "Explore novos artistas, coleções verificadas e obras digitais que definem a cultura.",
          },
        ].map((item) => (
          <div className="promo" key={item.title}>
            <ArtworkImage artwork={item.art} alt="" size="card" />
            <div>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <Link className="solid-link" to="/" hash="mercado" search={true}>
                Explorar →
              </Link>
            </div>
          </div>
        ))}
      </section>
      <section className="editorial" id="aprenda">
        <h2>Diário da Cunhagem</h2>
        <p>
          Histórias, guias e insights para colecionadores sobre o universo da
          propriedade digital.
        </p>
        <div>
          {editorials.map((item) => (
            <article key={item.title}>
              <ArtworkImage artwork={item.art} alt="" size="card" />
              <div>
                <small>15 de setembro | Leitura de 3 min</small>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
                <span>Conteúdo em breve →</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
export function FavoritesPage() {
  const { user, isLoading } = useAuth();
  const favorites = useFavorites();
  const navigate = useNavigate();
  const details = useQueries({
    queries: (favorites.data ?? []).map((id) => ({
      queryKey: ["nft", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        catalogApi.detail(id, signal),
    })),
  });
  useEffect(() => {
    if (!isLoading && !user)
      navigate({ to: "/login", search: { redirect: "/favorites" } });
  }, [user, isLoading, navigate]);
  const items = details.flatMap((detail) => (detail.data ? [detail.data] : []));
  return (
    <div className="wrap favorites-page">
      <h1>Meus favoritos</h1>
      {favorites.isLoading || details.some((d) => d.isLoading) ? (
        <p>Carregando favoritos...</p>
      ) : favorites.isError || details.some((d) => d.isError) ? (
        <div role="alert">
          Não foi possível carregar seus favoritos.{" "}
          <button
            onClick={() => {
              favorites.refetch();
              details.forEach((d) => d.refetch());
            }}
          >
            Tentar novamente
          </button>
        </div>
      ) : items.length ? (
        <div className="nft-grid">
          {items.map((nft) => (
            <NftCard key={nft.id} nft={nft} />
          ))}
        </div>
      ) : (
        <p>
          Você ainda não adicionou NFTs aos favoritos.{" "}
          <Link to="/">Explorar coleção</Link>
        </p>
      )}
    </div>
  );
}

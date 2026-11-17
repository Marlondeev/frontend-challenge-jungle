import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Heart, Minus, Plus, ShoppingCart } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  useCartActions,
  useCatalog,
  useFavorites,
  useNft,
  useToggleFavorite,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { errorMessage, getToken } from "@/lib/api";
import { formatEth } from "@/lib/money";
import { ArtworkImage } from "@/components/ui/artwork";
import { NftCard } from "@/features/catalog/catalog-page";
import "@/styles/storefront.css";

const DetailAuthDialog = lazy(() =>
  import("@/features/auth/auth-page").then((module) => ({
    default: module.AuthDialog,
  })),
);

export function NftPage({ id }: { id: string }) {
  const nft = useNft(id);
  const favorites = useFavorites();
  const { mutate: toggleFavorite } = useToggleFavorite();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { add } = useCartActions();
  const [editionSelection, setEditionSelection] = useState({
    nftId: id,
    editionId: "",
  });
  const editionId =
    editionSelection.nftId === id ? editionSelection.editionId : "";
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState<"details" | "reviews">("details");
  const [message, setMessage] = useState("");
  const [crop, setCrop] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const favoriteTrigger = useRef<{
    element: HTMLButtonElement;
    nftId: string;
  } | null>(null);
  const loginNft = useRef<string | null>(null);
  const requestedFavorite = useRef<{
    nftId: string;
    ownerId: string;
    token: string | null;
  } | null>(null);
  useEffect(() => {
    setQuantity(1);
    setAuthOpen(false);
    loginNft.current = null;
    requestedFavorite.current = null;
  }, [id]);
  useEffect(() => {
    const request = requestedFavorite.current;
    if (!request) return;
    if (
      request.nftId !== id ||
      !request.token ||
      getToken() !== request.token
    ) {
      requestedFavorite.current = null;
      return;
    }
    // Wait for the authenticated owner to reach this hook before mutating its cache.
    if (user?.id !== request.ownerId) return;
    requestedFavorite.current = null;
    toggleFavorite({ nftId: request.nftId, favorite: true });
  }, [authOpen, id, user?.id, toggleFavorite]);
  useEffect(() => {
    const editions = nft.data?.editions ?? [];
    const selected =
      editions.find((e) => e.id === editionId && e.stock > 0) ??
      editions.find(
        (e) => e.id === nft.data?.defaultEditionId && e.stock > 0,
      ) ??
      editions.find((e) => e.stock > 0);
    if (editionId !== (selected?.id ?? ""))
      setEditionSelection({ nftId: id, editionId: selected?.id ?? "" });
    setQuantity((current) =>
      selected ? Math.max(1, Math.min(current, selected.stock)) : 1,
    );
  }, [nft.data?.editions, nft.data?.defaultEditionId, editionId, id]);
  if (nft.isLoading)
    return (
      <section
        className="wrap detail-skeleton"
        role="status"
        aria-label="Carregando NFT"
      >
        <div className="card-skeleton" />
        <div className="card-skeleton" />
      </section>
    );
  if (nft.isError || !nft.data)
    return (
      <div className="wrap state-box" role="alert">
        <h1>NFT indisponível</h1>
        <p>
          {nft.isError ? errorMessage(nft.error) : "Não encontramos este NFT."}
        </p>
        <button onClick={() => nft.refetch()}>Tentar novamente</button>{" "}
        <Link to="/" hash="mercado">
          Voltar ao mercado
        </Link>
      </div>
    );
  const item = nft.data;
  const edition = item.editions.find((e) => e.id === editionId);
  const favorite = favorites.data?.includes(id) ?? false;
  const available = !!edition && edition.stock >= quantity && quantity > 0;
  const favoriteAction = (event: MouseEvent<HTMLButtonElement>) => {
    if (!user) {
      favoriteTrigger.current = { element: event.currentTarget, nftId: id };
      loginNft.current = id;
      setAuthOpen(true);
      return;
    }
    toggleFavorite({ nftId: id, favorite: !favorite });
  };
  const addToCart = async (buy: boolean) => {
    if (!edition || !available) return;
    try {
      await add.mutateAsync({ nftId: id, editionId: edition.id, quantity });
      setMessage("NFT adicionado ao carrinho.");
      if (buy) navigate({ to: "/cart" });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };
  return (
    <div className="wrap nft-detail">
      <div className="detail-mobile-top">
        <Link to="/" hash="mercado" aria-label="Voltar ao mercado">
          <ArrowLeft />
        </Link>
        <button
          aria-label={favorite ? "Remover dos favoritos" : "Favoritar"}
          aria-pressed={favorite}
          onClick={favoriteAction}
        >
          <Heart fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="breadcrumb">
        <Link to="/">Início</Link> /{" "}
        <Link to="/" hash="mercado">
          Mercado
        </Link>
      </div>
      <div className="detail-main">
        <div className="gallery">
          <div className="thumbnails">
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                aria-label={`Visualização ${i + 1}`}
                aria-pressed={crop === i}
                onClick={() => setCrop(i)}
              >
                <ArtworkImage artwork={item.artwork} alt="" size="thumb" />
              </button>
            ))}
          </div>
          <div className={`detail-image crop-${crop}`}>
            <ArtworkImage
              artwork={item.artwork}
              alt={item.name}
              size="hero"
              eager
            />
          </div>
        </div>
        <div className="detail-info">
          <div className="detail-heading">
            <h1>{item.name}</h1>
            <span className="rating">
              ★ {item.rating} <small>({item.reviews})</small>
            </span>
          </div>
          <div className="detail-price">
            {formatEth(item.price)} ETH{" "}
            <span>
              ★★★★★ <small>{item.reviews} avaliações de colecionadores</small>
            </span>
          </div>
          <h2 className="sr-only">Informações da obra</h2>
          <h3>Sobre este NFT:</h3>
          <p>{item.description}</p>
          <h3>Edição:</h3>
          <div className="editions">
            {item.editions.map((e) => (
              <button
                key={e.id}
                disabled={!e.stock}
                aria-pressed={editionId === e.id}
                onClick={() => {
                  setEditionSelection({ nftId: id, editionId: e.id });
                  setQuantity(1);
                }}
              >
                {e.label}
                {!e.stock ? " (esgotada)" : ""}
              </button>
            ))}
          </div>
          <div className="desktop-purchase">
            <Quantity
              quantity={quantity}
              setQuantity={setQuantity}
              stock={edition?.stock ?? 0}
            />
            <button
              className="solid-link"
              disabled={!available || add.isPending}
              onClick={() => addToCart(true)}
            >
              COMPRAR
            </button>
            <button
              className="outline-link"
              aria-pressed={favorite}
              onClick={favoriteAction}
            >
              <Heart size={18} fill={favorite ? "currentColor" : "none"} />{" "}
              {favorite ? "Favoritado" : "Favoritar"}
            </button>
            <button
              className="outline-link"
              disabled={!available || add.isPending}
              onClick={() => addToCart(false)}
            >
              Adicionar ao carrinho
            </button>
          </div>
          <div className="metadata">
            <p>ID do token: #{item.id}</p>
            <p>Coleção: {item.collection}</p>
            <p>Atributos: {item.rarity || item.category}</p>
            <p>Rede: {item.network}</p>
          </div>
          <p role="status">{message}</p>
        </div>
      </div>
      <div className="detail-tabs">
        <div role="tablist" aria-label="Informações do NFT">
          <button
            role="tab"
            aria-selected={tab === "details"}
            onClick={() => setTab("details")}
          >
            Detalhes do NFT
          </button>
          <button
            role="tab"
            aria-selected={tab === "reviews"}
            onClick={() => setTab("reviews")}
          >
            Avaliações de colecionadores ({item.reviews})
          </button>
        </div>
        {tab === "details" ? (
          <div role="tabpanel">
            <p>{item.description}</p>
            <p>
              A propriedade inclui a arte digital e um registro de procedência
              na rede.
            </p>
            <p>
              <strong>Rede:</strong>
              <br />
              {item.network}
            </p>
            <p>
              <strong>Coleção:</strong>
              <br />
              {item.collection}
            </p>
          </div>
        ) : (
          <div role="tabpanel">
            <p>
              Este NFT possui {item.reviews} avaliações e nota média{" "}
              {item.rating}. Os comentários individuais não estão disponíveis
              nesta demonstração.
            </p>
          </div>
        )}
      </div>
      <RelatedCollection category={item.category} currentId={id} />
      <div className="mobile-purchase">
        <div>
          <span>
            Qtd.{" "}
            <Quantity
              quantity={quantity}
              setQuantity={setQuantity}
              stock={edition?.stock ?? 0}
            />
          </span>
          <strong>{formatEth(item.price)} ETH</strong>
        </div>
        <div>
          <button
            className="solid-link"
            disabled={!available || add.isPending}
            onClick={() => addToCart(true)}
          >
            Comprar NFT
          </button>
          <button
            className="outline-link"
            aria-label="Adicionar ao carrinho"
            disabled={!available || add.isPending}
            onClick={() => addToCart(false)}
          >
            <ShoppingCart />
          </button>
        </div>
        {!available && <p>Esta obra está esgotada.</p>}
      </div>
      {authOpen && (
        <Suspense fallback={null}>
          <DetailAuthDialog
            onClose={() => {
              loginNft.current = null;
              requestedFavorite.current = null;
              setAuthOpen(false);
            }}
            onAuthenticated={(authenticated) => {
              const requestedNft = loginNft.current;
              loginNft.current = null;
              if (requestedNft === id)
                requestedFavorite.current = {
                  nftId: id,
                  ownerId: authenticated.id,
                  token: getToken(),
                };
              setAuthOpen(false);
            }}
            onCloseAutoFocus={(event) => {
              const trigger = favoriteTrigger.current;
              if (trigger?.nftId === id && trigger.element.isConnected) {
                event.preventDefault();
                trigger.element.focus({ preventScroll: true });
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
function RelatedCollection({
  category,
  currentId,
}: {
  category: string;
  currentId: string;
}) {
  // Mount after the detail resolves, so a category query never first requests
  // and renders the unrelated full catalogue before being replaced.
  const related = useCatalog({ category });
  return (
    <section className="related">
      <h2>Mais desta coleção</h2>
      {related.isLoading ? (
        <div
          className="related-grid"
          role="status"
          aria-label="Carregando coleção"
        >
          <div className="card-skeleton" />
          <div className="card-skeleton" />
        </div>
      ) : related.isError ? (
        <button onClick={() => related.refetch()}>
          Tentar carregar coleção novamente
        </button>
      ) : (
        <div className="related-grid">
          {related.data?.items
            .filter((n) => n.id !== currentId)
            .slice(0, 5)
            .map((n) => (
              <NftCard nft={n} key={n.id} />
            ))}
        </div>
      )}
    </section>
  );
}
function Quantity({
  quantity,
  setQuantity,
  stock,
}: {
  quantity: number;
  setQuantity: (n: number) => void;
  stock: number;
}) {
  return (
    <span className="quantity">
      <button
        aria-label="Diminuir quantidade"
        disabled={quantity <= 1}
        onClick={() => setQuantity(quantity - 1)}
      >
        <Minus size={16} />
      </button>
      <span aria-live="polite">{quantity}</span>
      <button
        aria-label="Aumentar quantidade"
        disabled={quantity >= stock}
        onClick={() => setQuantity(quantity + 1)}
      >
        <Plus size={16} />
      </button>
    </span>
  );
}

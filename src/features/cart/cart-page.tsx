import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart, useCartActions, useQuote, useCatalog } from "@/lib/hooks";
import { errorMessage, fieldErrors } from "@/lib/api";
import { formatEth } from "@/lib/money";
import { ArtworkImage } from "@/components/ui/artwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { ErrorState, PageHeading } from "@/features/account/account-ui";
import { Totals } from "./purchase-summary";
import { CartSkeleton, QuoteSkeleton } from "./purchase-skeleton";
import "@/styles/account.css";

export function CartPage() {
  const cart = useCart();
  const quote = useQuote();
  const actions = useCartActions();
  const related = useCatalog({});
  const [code, setCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const busy =
    actions.update.isPending ||
    actions.remove.isPending ||
    actions.coupon.isPending;
  async function coupon(event: FormEvent) {
    event.preventDefault();
    setCouponError("");
    try {
      await actions.coupon.mutateAsync(code.trim());
      notify("Código promocional aplicado.", "success");
    } catch (error) {
      setCouponError(fieldErrors(error).code || errorMessage(error));
    }
  }
  async function change(id: string, quantity: number) {
    try {
      await actions.update.mutateAsync({ id, quantity });
      notify("Quantidade atualizada.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  return (
    <div className="purchase-page cart-page">
      <PageHeading title="Carrinho de NFTs" />
      {cart.isPending ? (
        <CartSkeleton />
      ) : cart.isError ? (
        <ErrorState
          message={errorMessage(cart.error)}
          retry={() => void cart.refetch()}
        />
      ) : !cart.data.items.length ? (
        <section className="account-state">
          <h1>Seu carrinho está vazio</h1>
          <p>Encontre a próxima arte da sua coleção.</p>
          <Button asChild>
            <Link to="/">Explorar NFTs</Link>
          </Button>
        </section>
      ) : (
        <>
          <div className="cart-layout">
            <section className="cart-list" aria-label="NFTs no carrinho">
              <div className="cart-table-heading">
                <span>NFTs</span>
                <span>Preço</span>
                <span>Edições</span>
                <span>Total</span>
              </div>
              {cart.data.items.map((item) => {
                const edition = item.nft.editions.find(
                  (e) => e.id === item.editionId,
                );
                const quoted = quote.data?.items.find(
                  (i) =>
                    i.nftId === item.nftId && i.editionId === item.editionId,
                );
                return (
                  <article className="cart-row" key={item.id}>
                    <ArtworkImage
                      artwork={item.nft.artwork}
                      size="thumb"
                      alt={item.nft.name}
                    />
                    <div className="cart-item-name">
                      <Link to="/nft/$id" params={{ id: item.nftId }}>
                        {item.nft.name}
                      </Link>
                      <small>
                        <span className="cart-edition-label">Edição: </span>
                        {edition?.label ?? item.editionId}
                      </small>
                    </div>
                    <span className="cart-unit-price">
                      {formatEth(item.nft.price)} ETH
                    </span>
                    <div className="cart-quantity">
                      <button
                        aria-label={`Diminuir quantidade de ${item.nft.name}`}
                        disabled={busy || item.quantity <= 1}
                        onClick={() => void change(item.id, item.quantity - 1)}
                      >
                        <Minus size={15} />
                      </button>
                      <output aria-label="Quantidade">{item.quantity}</output>
                      <button
                        aria-label={`Aumentar quantidade de ${item.nft.name}`}
                        disabled={
                          busy ||
                          item.quantity >= (edition?.stock ?? item.quantity)
                        }
                        onClick={() => void change(item.id, item.quantity + 1)}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    <strong className="price cart-line-price">
                      {quoted ? `${formatEth(quoted.lineTotal)} ETH` : "…"}
                    </strong>
                    <button
                      className="cart-remove"
                      aria-label={`Remover ${item.nft.name}`}
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await actions.remove.mutateAsync(item.id);
                          notify("NFT removido do carrinho.", "success");
                        } catch (error) {
                          notify(errorMessage(error), "error");
                        }
                      }}
                    >
                      <Trash2 size={19} />
                    </button>
                  </article>
                );
              })}
            </section>
            <aside className="cart-summary">
              <h2>Resumo da carteira</h2>
              <form onSubmit={coupon} className="coupon-form">
                <label htmlFor="cart-coupon">Código promocional</label>
                <div>
                  <Input
                    id="cart-coupon"
                    placeholder="Digite o código promocional…"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    aria-invalid={!!couponError}
                    aria-describedby={couponError ? "coupon-error" : undefined}
                  />
                  <Button disabled={busy || !code.trim()} type="submit">
                    Aplicar
                  </Button>
                </div>
                {couponError && (
                  <p role="alert" id="coupon-error" className="field-error">
                    {couponError}
                  </p>
                )}
                {cart.data.coupon && (
                  <button
                    type="button"
                    className="coupon-applied"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await actions.coupon.mutateAsync(null);
                        setCode("");
                        setCouponError("");
                      } catch (error) {
                        notify(errorMessage(error), "error");
                      }
                    }}
                  >
                    {cart.data.coupon} · Remover código
                  </button>
                )}
              </form>
              {quote.isPending || quote.isFetching ? (
                <QuoteSkeleton />
              ) : quote.isError ? (
                <ErrorState
                  message={errorMessage(quote.error)}
                  retry={() => void quote.refetch()}
                />
              ) : (
                quote.data && <Totals quote={quote.data} />
              )}
              <Button
                asChild
                disabled={busy || !quote.data || quote.isFetching}
                className="checkout-link"
              >
                <Link
                  to="/checkout"
                  aria-disabled={busy || !quote.data || quote.isFetching}
                  tabIndex={
                    busy || !quote.data || quote.isFetching ? -1 : undefined
                  }
                  onClick={(event) => {
                    if (busy || !quote.data || quote.isFetching)
                      event.preventDefault();
                  }}
                >
                  Conectar e finalizar
                </Link>
              </Button>
              <Link to="/" hash="mercado" className="continue-shopping">
                Continuar explorando
              </Link>
            </aside>
          </div>
          {related.data?.items.length ? (
            <section className="cart-related">
              <h2>Colecionadores também viram</h2>
              <div>
                {related.data.items.slice(0, 5).map((nft) => (
                  <Link to="/nft/$id" params={{ id: nft.id }} key={nft.id}>
                    <ArtworkImage
                      artwork={nft.artwork}
                      size="card"
                      alt={nft.name}
                    />
                    <span>{nft.name}</span>
                    <strong className="price">
                      {formatEth(nft.price)} ETH
                    </strong>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

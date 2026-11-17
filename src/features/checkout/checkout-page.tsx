import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Wallet as WalletIcon } from "lucide-react";
import type { CollectorSnapshot, Provider, Quote } from "@/domain/types";
import { useAuth } from "@/lib/auth";
import { useCart, useQuote, useWallets } from "@/lib/hooks";
import { cartApi, checkoutApi, errorMessage, fieldErrors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { ErrorState, Field, PageHeading } from "@/features/account/account-ui";
import { PurchaseItems, Totals } from "@/features/cart/purchase-summary";
import { QuoteSkeleton } from "@/features/cart/purchase-skeleton";
import {
  parseAttempt,
  quoteNeedsReview,
  type PurchaseAttempt,
} from "./purchase-state";
import "@/styles/account.css";

interface CollectorDraft extends CollectorSnapshot {
  userId: string;
  walletId: string;
  provider?: Provider;
}
const providers: Provider[] = ["WalletConnect", "MetaMask", "Coinbase Wallet"];
export function CheckoutPage() {
  const { user } = useAuth();
  const cart = useCart();
  const quoteQuery = useQuote();
  const wallets = useWallets();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [draft, setDraft] = useState<CollectorDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{
    quote: Quote;
    cartVersion: number;
    collector: CollectorSnapshot;
    walletId: string;
    provider: Provider;
  } | null>(null);
  const [freshQuote, setFreshQuote] = useState<Quote | null>(null);
  const [attempt, setAttempt] = useState<PurchaseAttempt | null>(null);
  const [recovering, setRecovering] = useState(true);
  const [recoveryError, setRecoveryError] = useState("");
  const [failure, setFailure] = useState("");
  const [connected, setConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 769px)").matches,
  );
  const lock = useRef(false);
  const generation = useRef(0);
  const activeUser = useRef(user?.id);
  activeUser.current = user?.id;
  const userSnapshot = useRef(user);
  userSnapshot.current = user;
  const userId = user?.id;
  const attemptKey = user ? `kurio.purchase.${user.id}` : "";
  const draftKey = user ? `kurio.checkout.${user.id}` : "";
  const revalidate = useMutation({
    mutationFn: (previous?: string) => checkoutApi.quote(previous),
  });
  const place = useMutation({ mutationFn: checkoutApi.place });
  const pending =
    submitting || revalidate.isPending || place.isPending || recovering;
  const quote = freshQuote ?? quoteQuery.data;
  const wallet = wallets.data?.find((w) => w.id === draft?.walletId);
  const provider = draft?.provider ?? wallet?.provider;
  const owns = (originalUser: string, originalGeneration: number) =>
    activeUser.current === originalUser &&
    generation.current === originalGeneration;
  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => {
      generation.current = currentGeneration + 1;
    };
  }, [userId]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 769px)");
    const change = () => setDesktop(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const user = userSnapshot.current;
    if (!user) return;
    const originalUser = user.id;
    const originalGeneration = generation.current;
    let stored: Partial<CollectorDraft> = {};
    try {
      const value = JSON.parse(
        sessionStorage.getItem(`kurio.checkout.${originalUser}`) ?? "null",
      );
      if (value?.userId === originalUser) stored = value;
    } catch {
      /* A malformed draft is safely ignored. */
    }
    setDraft({
      userId: originalUser,
      displayName: user.displayName,
      email: user.email,
      username: user.username,
      ens: user.ens,
      note: "",
      walletId: "",
      ...stored,
    });
    setReview(null);
    setFreshQuote(null);
    setConnected(false);
    setSubmitting(false);
    lock.current = false;
    setRecoveryError("");
    setFailure("");
    const previous = parseAttempt(
      sessionStorage.getItem(`kurio.purchase.${originalUser}`),
      originalUser,
    );
    setAttempt(previous);
    if (!previous) {
      setRecovering(false);
      return;
    }
    setRecovering(true);
    client
      .fetchQuery({
        queryKey: ["order", originalUser, "recovery", previous.key],
        queryFn: () => checkoutApi.recover(previous.key),
        staleTime: 0,
        gcTime: 0,
        retry: false,
      })
      .then((order) => {
        if (owns(originalUser, originalGeneration))
          void navigate({ to: "/order/$id", params: { id: order.id } });
      })
      .catch((error) => {
        if (owns(originalUser, originalGeneration))
          setRecoveryError(
            axios.isAxiosError(error) && error.response?.status === 404
              ? "Nenhum pedido foi encontrado para a tentativa anterior. Você pode repetir a mesma tentativa com segurança."
              : errorMessage(error),
          );
      })
      .finally(() => {
        if (owns(originalUser, originalGeneration)) setRecovering(false);
      });
  }, [userId, client, navigate]);
  useEffect(() => {
    if (draft && draft.userId === user?.id)
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }, [draft, draftKey, user?.id]);
  const selectedId =
    draft?.walletId ||
    wallets.data?.find((w) => w.primary)?.id ||
    wallets.data?.[0]?.id ||
    "";
  useEffect(() => {
    if (selectedId)
      setDraft((v) => (v && !v.walletId ? { ...v, walletId: selectedId } : v));
  }, [selectedId]);
  async function recoverPurchase(previous: PurchaseAttempt) {
    const originalGeneration = generation.current;
    if (!owns(previous.userId, originalGeneration)) return;
    setRecovering(true);
    setRecoveryError("");
    try {
      const order = await client.fetchQuery({
        queryKey: ["order", previous.userId, "recovery", previous.key],
        queryFn: () => checkoutApi.recover(previous.key),
        staleTime: 0,
        gcTime: 0,
        retry: false,
      });
      if (owns(previous.userId, originalGeneration))
        await navigate({ to: "/order/$id", params: { id: order.id } });
    } catch (error) {
      if (!owns(previous.userId, originalGeneration)) return;
      setRecoveryError(
        axios.isAxiosError(error) && error.response?.status === 404
          ? "O pedido ainda não foi encontrado. Repita a mesma tentativa ou inicie uma nova compra após revisar."
          : errorMessage(error),
      );
    } finally {
      if (owns(previous.userId, originalGeneration)) setRecovering(false);
    }
  }
  async function send(previous: PurchaseAttempt) {
    const originalGeneration = generation.current;
    if (!owns(previous.userId, originalGeneration)) return;
    if (previous.invalidIntent) {
      setRecoveryError(
        "Os dados salvos desta tentativa estão incompletos. Verifique o pedido ou revise como nova compra para continuar.",
      );
      return;
    }
    sessionStorage.setItem(
      `kurio.purchase.${previous.userId}`,
      JSON.stringify(previous),
    );
    setAttempt(previous);
    try {
      const order = await place.mutateAsync({
        quoteId: previous.quoteId,
        walletId: previous.walletId,
        idempotencyKey: previous.key,
        ...(previous.collector ? { collector: previous.collector } : {}),
        ...(previous.provider ? { provider: previous.provider } : {}),
      });
      if (owns(previous.userId, originalGeneration))
        await navigate({ to: "/order/$id", params: { id: order.id } });
    } catch (error) {
      if (!owns(previous.userId, originalGeneration)) return;
      setFailure(errorMessage(error));
      setErrors(fieldErrors(error));
      if (
        Object.keys(fieldErrors(error)).some((key) =>
          ["displayName", "username", "email", "ens", "note"].includes(key),
        )
      )
        setCollectorOpen(true);
      setReview(null);
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        try {
          const fresh = await revalidate.mutateAsync(previous.quoteId);
          if (!owns(previous.userId, originalGeneration)) return;
          setFreshQuote(fresh);
        } catch {
          /* The original error remains visible and retryable. */
        }
        if (!owns(previous.userId, originalGeneration)) return;
        setRecoveryError(
          "A cotação ou o estoque mudou. Revise o resumo e inicie uma nova tentativa. O carrinho foi preservado.",
        );
      } else await recoverPurchase(previous);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || pending || !draft || !user || !quote) return;
    const originalGeneration = generation.current;
    const originalUser = user.id;
    const collector: CollectorSnapshot = {
      displayName: draft.displayName.trim(),
      username: draft.username.trim(),
      email: draft.email.trim(),
      ens: draft.ens.trim(),
      note: draft.note.trim(),
    };
    const next: Record<string, string> = {};
    if (collector.displayName.length < 2 || collector.displayName.length > 80)
      next.displayName = "Informe seu nome de exibição.";
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(collector.username))
      next.username = "Use de 3 a 24 letras, números, pontos ou traços.";
    if (
      collector.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collector.email)
    )
      next.email = "Informe um e-mail válido.";
    if (!wallet) next.walletId = "Selecione uma carteira cadastrada.";
    if (!connected) next.walletId = "Conecte a carteira para continuar.";
    if (
      collector.ens.length > 100 ||
      (collector.ens &&
        !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.eth$/.test(collector.ens))
    )
      next.ens = "Informe um nome terminado em .eth ou deixe em branco.";
    if (collector.note.length > 500) next.note = "Use até 500 caracteres.";
    if (!provider || (wallet?.network === "Solana" && provider === "MetaMask"))
      next.provider = "Selecione um provedor compatível com a rede.";
    setErrors(next);
    setFailure("");
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0];
      if (!["walletId", "provider"].includes(first)) setCollectorOpen(true);
      const target =
        first === "displayName"
          ? "checkout-name"
          : first === "walletId"
            ? "payment-wallet"
            : `checkout-${first}`;
      requestAnimationFrame(() =>
        (
          document.getElementById(target) ??
          document.querySelector<HTMLInputElement>(
            'input[name="payment-wallet"]',
          )
        )?.focus(),
      );
      return;
    }
    lock.current = true;
    setSubmitting(true);
    try {
      const currentCart = await client.fetchQuery({
        queryKey: ["cart", user.id],
        queryFn: cartApi.get,
        staleTime: 0,
      });
      if (!owns(originalUser, originalGeneration)) return;
      if (!currentCart.items.length) {
        setFailure(
          "Seu carrinho está vazio. Volte ao mercado para escolher uma arte.",
        );
        return;
      }
      const fresh = await revalidate.mutateAsync(review?.quote.id ?? quote.id);
      if (!owns(originalUser, originalGeneration)) return;
      setFreshQuote(fresh);
      if (
        !review ||
        quoteNeedsReview(review.quote, fresh) ||
        currentCart.version !== review.cartVersion ||
        review.walletId !== wallet!.id ||
        review.provider !== provider ||
        JSON.stringify(review.collector) !== JSON.stringify(collector)
      ) {
        setReview({
          quote: fresh,
          cartVersion: currentCart.version,
          collector,
          walletId: wallet!.id,
          provider: provider!,
        });
        if (review || quoteNeedsReview(quote, fresh))
          notify(
            "A cotação foi atualizada. Revise os valores e confirme novamente.",
            "info",
          );
        return;
      }
      await send({
        userId: user.id,
        key: crypto.randomUUID(),
        quoteId: fresh.id,
        walletId: review.walletId,
        collector: review.collector,
        provider: review.provider,
      });
    } catch (error) {
      if (!owns(originalUser, originalGeneration)) return;
      setFailure(errorMessage(error));
      setReview(null);
    } finally {
      if (owns(originalUser, originalGeneration)) {
        lock.current = false;
        setSubmitting(false);
      }
    }
  }
  function update<Key extends keyof CollectorDraft>(
    key: Key,
    value: CollectorDraft[Key],
  ) {
    setDraft((v) => (v ? { ...v, [key]: value } : v));
    setReview(null);
  }
  if (!draft || draft.userId !== user?.id || recovering)
    return (
      <div className="purchase-page">
        <PageHeading title="Pagamento com carteira" back="/cart" />
        <p className="account-state" role="status">
          {attempt
            ? "Recuperando sua compra com segurança…"
            : "Preparando pagamento…"}
        </p>
      </div>
    );
  return (
    <div className="purchase-page checkout-page">
      <PageHeading title="Pagamento com carteira" back="/cart" />
      {attempt ? (
        <section className="purchase-recovery" role="status">
          <h1>Uma compra está em andamento</h1>
          <p>
            {recoveryError ||
              failure ||
              "Recupere a tentativa anterior antes de iniciar outra compra."}
          </p>
          {attempt.invalidIntent && (
            <p>
              Os dados salvos estão incompletos. Verifique o pedido ou revise
              como nova compra antes de continuar.
            </p>
          )}
          <div className="form-actions">
            <Button
              disabled={pending}
              onClick={() => void recoverPurchase(attempt)}
            >
              Verificar pedido
            </Button>
            <Button
              variant="outline"
              disabled={pending || !!attempt.invalidIntent}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                try {
                  await send(attempt);
                } finally {
                  lock.current = false;
                }
              }}
            >
              Repetir mesma tentativa
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                const originalGeneration = generation.current;
                const previous = attempt;
                setRecovering(true);
                try {
                  const order = await client.fetchQuery({
                    queryKey: [
                      "order",
                      attempt.userId,
                      "recovery",
                      attempt.key,
                    ],
                    queryFn: () => checkoutApi.recover(attempt.key),
                    staleTime: 0,
                    gcTime: 0,
                    retry: false,
                  });
                  if (!owns(previous.userId, originalGeneration)) return;
                  await navigate({
                    to: "/order/$id",
                    params: { id: order.id },
                  });
                } catch (error) {
                  if (!owns(previous.userId, originalGeneration)) return;
                  if (
                    axios.isAxiosError(error) &&
                    error.response?.status === 404
                  ) {
                    sessionStorage.removeItem(attemptKey);
                    setAttempt(null);
                    setReview(null);
                    setFailure("");
                    setRecoveryError("");
                    notify(
                      "Revise a cotação antes de iniciar uma nova compra.",
                      "info",
                    );
                  } else setRecoveryError(errorMessage(error));
                } finally {
                  if (owns(previous.userId, originalGeneration))
                    setRecovering(false);
                }
              }}
            >
              Revisar como nova compra
            </Button>
          </div>
        </section>
      ) : null}
      {cart.isError ? (
        <ErrorState
          message={errorMessage(cart.error)}
          retry={() => void cart.refetch()}
        />
      ) : cart.data && !cart.data.items.length && !attempt ? (
        <section className="account-state">
          <h1>Seu carrinho está vazio</h1>
          <Button asChild>
            <Link to="/">Explorar NFTs</Link>
          </Button>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="checkout-layout">
          <details
            className="collector-form"
            open={desktop || collectorOpen}
            onToggle={(event) => {
              if (!desktop) setCollectorOpen(event.currentTarget.open);
              else event.currentTarget.open = true;
            }}
          >
            <summary tabIndex={desktop ? -1 : 0}>
              <h1>Perfil do colecionador</h1>
              <span>Editar dados</span>
            </summary>
            <fieldset
              className="collector-fields"
              disabled={pending || !!attempt}
            >
              <div className="account-form-grid">
                <Field
                  id="checkout-name"
                  label="Nome de exibição"
                  required
                  maxLength={80}
                  value={draft.displayName}
                  error={errors.displayName}
                  onChange={(e) => update("displayName", e.target.value)}
                />
                <Field
                  id="checkout-username"
                  label="Nome de usuário"
                  required
                  maxLength={24}
                  value={draft.username}
                  error={errors.username}
                  onChange={(e) => update("username", e.target.value)}
                />
                <Field
                  id="checkout-email"
                  label="E-mail"
                  type="email"
                  required
                  maxLength={254}
                  value={draft.email}
                  error={errors.email}
                  onChange={(e) => update("email", e.target.value)}
                />
                <Field
                  id="checkout-ens"
                  label="Nome ENS (opcional)"
                  placeholder="colecionador.eth"
                  value={draft.ens}
                  maxLength={100}
                  error={errors.ens}
                  onChange={(e) => update("ens", e.target.value)}
                />
                {wallet && (
                  <>
                    <Field
                      id="checkout-network"
                      label="Rede"
                      readOnly
                      value={wallet.network}
                    />
                    <Field
                      id="checkout-address"
                      label="Endereço da carteira"
                      readOnly
                      value={wallet.address}
                    />
                    <Field
                      id="checkout-provider"
                      label="Tipo de carteira"
                      readOnly
                      value={provider ?? wallet.provider}
                    />
                  </>
                )}
              </div>
              <div className="account-field">
                <label htmlFor="checkout-note">
                  Observação do colecionador (opcional)
                </label>
                <textarea
                  id="checkout-note"
                  maxLength={500}
                  value={draft.note}
                  aria-invalid={!!errors.note}
                  aria-describedby={
                    errors.note ? "checkout-note-error" : undefined
                  }
                  onChange={(e) => update("note", e.target.value)}
                />
                {errors.note && (
                  <span
                    className="field-error"
                    id="checkout-note-error"
                    role="alert"
                  >
                    {errors.note}
                  </span>
                )}
              </div>
            </fieldset>
          </details>
          <aside className="checkout-summary">
            <h2>Seus NFTs</h2>
            {quoteQuery.isPending ? (
              <QuoteSkeleton />
            ) : quoteQuery.isError && !freshQuote ? (
              <ErrorState
                message={errorMessage(quoteQuery.error)}
                retry={() => void quoteQuery.refetch()}
              />
            ) : quote ? (
              <>
                <PurchaseItems items={quote.items} />
                <Totals quote={quote} />
              </>
            ) : null}
            <section className="checkout-wallets">
              <div className="account-section-heading">
                <h2>Carteira conectada</h2>
                <Link to="/account/wallets">Trocar carteira</Link>
              </div>
              {wallets.isPending ? (
                <p role="status">Carregando carteiras…</p>
              ) : wallets.isError ? (
                <ErrorState
                  message={errorMessage(wallets.error)}
                  retry={() => void wallets.refetch()}
                />
              ) : !wallets.data?.length ? (
                <p>
                  Cadastre uma carteira para continuar.{" "}
                  <Link to="/account/wallets">Adicionar carteira</Link>
                </p>
              ) : (
                <fieldset>
                  <legend className="sr-only">Escolha uma carteira</legend>
                  {wallets.data.map((w) => (
                    <label
                      key={w.id}
                      className={`wallet-choice ${selectedId === w.id ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="payment-wallet"
                        value={w.id}
                        checked={selectedId === w.id}
                        disabled={pending || !!attempt}
                        onChange={() => {
                          update("walletId", w.id);
                          update(
                            "provider",
                            w.network === "Solana" && w.provider === "MetaMask"
                              ? "WalletConnect"
                              : w.provider,
                          );
                          setConnected(false);
                        }}
                      />
                      <span>
                        <strong>{w.label}</strong>
                        <small>
                          {w.ens ||
                            `${w.address.slice(0, 9)}…${w.address.slice(-5)}`}
                        </small>
                        <small>Rede {w.network}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {wallet && (
                <fieldset
                  className="connection-providers"
                  disabled={pending || !!attempt}
                >
                  <legend>Carteira e rede</legend>
                  {providers.map((choice) => (
                    <label
                      key={choice}
                      className={`provider-choice ${provider === choice ? "selected" : ""}`}
                    >
                      <span aria-hidden="true" className="provider-icon">
                        {choice === "Coinbase Wallet" ? (
                          <WalletIcon size={22} />
                        ) : (
                          choice[0]
                        )}
                      </span>
                      <span>{choice}</span>
                      <input
                        type="radio"
                        name="payment-provider"
                        value={choice}
                        checked={provider === choice}
                        disabled={
                          wallet.network === "Solana" && choice === "MetaMask"
                        }
                        onChange={() => {
                          update("provider", choice);
                          setConnected(false);
                        }}
                      />
                    </label>
                  ))}
                  {wallet.network === "Solana" && (
                    <p className="muted provider-help">
                      MetaMask indisponível na rede Solana desta demonstração.
                    </p>
                  )}
                </fieldset>
              )}
              {wallet && (
                <div className="connection-actions">
                  <p className="muted">Conexão e compra simuladas.</p>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={pending || !!attempt}
                    onClick={() => {
                      setConnected(!connected);
                      setReview(null);
                      notify(
                        connected
                          ? "Carteira desconectada."
                          : "Carteira conectada em modo de demonstração.",
                        "info",
                      );
                    }}
                  >
                    {connected ? "Desconectar carteira" : "Conectar carteira"}
                  </Button>
                  {!connected && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={pending || !!attempt}
                      onClick={() => {
                        setErrors({
                          walletId:
                            "Conexão recusada. Tente novamente quando desejar.",
                        });
                        notify(
                          "Conexão recusada; sua compra não foi enviada.",
                          "info",
                        );
                      }}
                    >
                      Simular recusa
                    </button>
                  )}
                </div>
              )}
              {errors.walletId && (
                <p className="field-error" role="alert">
                  {errors.walletId}
                </p>
              )}
              {errors.provider && (
                <p className="field-error" role="alert">
                  {errors.provider}
                </p>
              )}
            </section>
            {review && (
              <section className="purchase-review" aria-live="polite">
                <h2>Revise sua compra</h2>
                <p>
                  {review.quote.items.reduce(
                    (sum, item) => sum + item.quantity,
                    0,
                  )}{" "}
                  edição(ões) · {wallet?.label} · {wallet?.network} · {provider}
                </p>
                <p>
                  Ao confirmar, enviaremos esta compra simulada com os valores
                  exibidos acima.
                </p>
                <p className="review-collector">
                  <strong>{review.collector.displayName}</strong>
                  <br />
                  {review.collector.email} · @{review.collector.username}
                  {review.collector.ens && (
                    <>
                      <br />
                      {review.collector.ens}
                    </>
                  )}
                  {review.collector.note && (
                    <>
                      <br />
                      Observação: {review.collector.note}
                    </>
                  )}
                </p>
                <p className="muted">
                  Estes dados serão registrados no comprovante desta compra.
                </p>
                <div className="review-costs">
                  <Totals quote={review.quote} />
                </div>
              </section>
            )}
            {failure && (
              <p className="field-error" role="alert">
                {failure}
              </p>
            )}
          </aside>
          <div className="checkout-actions">
            <Button
              className="checkout-submit"
              type="submit"
              disabled={
                pending ||
                !!attempt ||
                !quote ||
                !wallet ||
                !cart.data?.items.length
              }
            >
              {pending
                ? "Verificando compra…"
                : review
                  ? "Confirmar compra"
                  : "Revisar compra"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

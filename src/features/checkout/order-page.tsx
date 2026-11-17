import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MailCheck, Clock3, CircleX } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useOrder } from "@/lib/hooks";
import { errorMessage } from "@/lib/api";
import { formatEth } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/features/account/account-ui";
import { PurchaseItems, Totals } from "@/features/cart/purchase-summary";
import { parseAttempt } from "./purchase-state";
import "@/styles/account.css";

export function OrderPage({ id }: { id: string }) {
  const order = useOrder(id);
  const { user } = useAuth();
  const client = useQueryClient();
  const [explorer, setExplorer] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (
      !userId ||
      !order.data ||
      order.data.status === "pending" ||
      order.data.userId !== userId
    )
      return;
    const key = `kurio.purchase.${userId}`;
    const attempt = parseAttempt(sessionStorage.getItem(key), userId);
    if (attempt?.key === order.data.idempotencyKey)
      sessionStorage.removeItem(key);
    if (order.data.status === "confirmed") {
      void client.invalidateQueries({ queryKey: ["cart", userId] });
      void client.invalidateQueries({ queryKey: ["quote", userId] });
    }
  }, [userId, order.data, client]);
  if (order.isPending)
    return (
      <div className="order-page">
        <p role="status" className="account-state">
          Carregando os detalhes da compra…
        </p>
      </div>
    );
  if (order.isError)
    return (
      <div className="order-page">
        <ErrorState
          message={errorMessage(order.error)}
          retry={() => void order.refetch()}
        />
        <Link to="/account">Voltar à minha conta</Link>
      </div>
    );
  const data = order.data;
  if (!data || data.userId !== user?.id)
    return (
      <div className="order-page">
        <ErrorState message="Este pedido não está disponível para sua conta." />
        <Link to="/account">Voltar à minha conta</Link>
      </div>
    );
  return (
    <div className="order-page">
      <article className="order-receipt">
        <Link to="/" className="receipt-close" aria-label="Fechar comprovante">
          ×
        </Link>
        <header className="receipt-heading">
          {data.status === "confirmed" ? (
            <MailCheck size={67} strokeWidth={1.2} />
          ) : data.status === "pending" ? (
            <Clock3 size={60} strokeWidth={1.2} />
          ) : (
            <CircleX size={60} strokeWidth={1.2} />
          )}
          <h1>
            {data.status === "confirmed"
              ? "Seus NFTs agora estão na sua carteira"
              : data.status === "pending"
                ? "Sua compra está sendo processada"
                : "Seu pagamento foi recusado"}
          </h1>
          <p role="status" aria-live="polite">
            {data.status === "pending"
              ? "Estamos aguardando a confirmação. Esta página será atualizada automaticamente; não é necessário pagar novamente."
              : data.status === "declined"
                ? data.declineReason ||
                  "A compra não foi concluída. Seus itens continuam no carrinho."
                : "Compra confirmada no ambiente de demonstração."}
          </p>
        </header>
        <dl className="receipt-metadata">
          <div>
            <dt>ID da transação</dt>
            <dd title={data.transactionId}>
              {data.transactionId || "Aguardando confirmação"}
            </dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>
              <time dateTime={data.createdAt}>
                {new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(data.createdAt))}
              </time>
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatEth(data.total)} ETH</dd>
          </div>
          <div>
            <dt>Carteira</dt>
            <dd>{data.walletLabel}</dd>
          </div>
        </dl>
        <section className="receipt-body">
          <h2>Detalhes da transação</h2>
          <div className="receipt-items-heading">
            <span>NFTs</span>
            <span>Edições</span>
            <span>Subtotal</span>
          </div>
          <PurchaseItems items={data.items} />
          <Totals quote={data} />
          <p className="receipt-wallet">
            {data.provider} · {data.network}
            <br />
            <span>{data.walletAddress}</span>
          </p>
          {data.collector && (
            <section
              className="receipt-collector"
              aria-label="Colecionador registrado na compra"
            >
              <h2>Colecionador</h2>
              <dl>
                <div>
                  <dt>Nome</dt>
                  <dd>{data.collector.displayName}</dd>
                </div>
                <div>
                  <dt>Usuário</dt>
                  <dd>@{data.collector.username}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>{data.collector.email}</dd>
                </div>
                {data.collector.ens && (
                  <div>
                    <dt>ENS</dt>
                    <dd>{data.collector.ens}</dd>
                  </div>
                )}
                {data.collector.note && (
                  <div>
                    <dt>Observação</dt>
                    <dd className="collector-note">{data.collector.note}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          <p className="receipt-disclaimer">
            {data.status === "confirmed"
              ? `Transação simulada confirmada na ${data.network}. Este comprovante registra os valores e a carteira selecionados no momento da compra.`
              : data.status === "pending"
                ? "Seu carrinho será atualizado somente após a confirmação da compra."
                : "Você pode revisar sua carteira e tentar novamente sem perder seus itens."}
          </p>
          <div className="receipt-actions">
            {data.status === "confirmed" ? (
              <Button onClick={() => setExplorer(true)}>
                Ver transação simulada
              </Button>
            ) : data.status === "declined" ? (
              <Button asChild>
                <Link to="/checkout">Revisar e tentar novamente</Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={order.isFetching}
                onClick={() => void order.refetch()}
              >
                Atualizar status
              </Button>
            )}
            <Link to="/">Continuar explorando</Link>
          </div>
        </section>
      </article>
      <Dialog.Root open={explorer} onOpenChange={setExplorer}>
        <Dialog.Portal>
          <Dialog.Overlay className="account-dialog-overlay" />
          <Dialog.Content className="account-dialog">
            <Dialog.Title>Transação de demonstração</Dialog.Title>
            <Dialog.Description>
              Esta compra foi simulada e não possui uma transação real em um
              explorador de blockchain.
            </Dialog.Description>
            <p className="transaction-id">{data.transactionId}</p>
            <Dialog.Close asChild>
              <Button>Entendi</Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

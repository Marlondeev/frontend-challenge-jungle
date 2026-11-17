import { Skeleton } from "@/components/ui/skeleton";

export function QuoteSkeleton() {
  return (
    <div
      className="purchase-quote-skeleton"
      role="status"
      aria-label="Atualizando resumo da compra"
    >
      <span className="sr-only">Atualizando resumo…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row}>
          <Skeleton />
          <Skeleton />
        </div>
      ))}
    </div>
  );
}
export function CartSkeleton() {
  return (
    <div
      className="cart-layout"
      role="status"
      aria-label="Carregando seu carrinho"
    >
      <div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="purchase-row-skeleton">
            <Skeleton />
            <div>
              <Skeleton />
              <Skeleton />
            </div>
            <Skeleton />
          </div>
        ))}
      </div>
      <aside className="cart-summary">
        <Skeleton className="purchase-summary-title-skeleton" />
        <Skeleton className="purchase-coupon-skeleton" />
        <QuoteSkeleton />
        <Skeleton className="purchase-action-skeleton" />
      </aside>
    </div>
  );
}

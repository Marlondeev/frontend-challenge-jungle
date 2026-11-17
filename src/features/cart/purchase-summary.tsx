import type { OrderItem, Quote } from "@/domain/types";
import { ArtworkImage } from "@/components/ui/artwork";
import { formatEth } from "@/lib/money";

export function PurchaseItems({ items }: { items: OrderItem[] }) {
  return (
    <div className="purchase-items">
      {items.map((item) => (
        <div className="purchase-item" key={`${item.nftId}-${item.editionId}`}>
          <ArtworkImage artwork={item.artwork} size="thumb" alt={item.name} />
          <div>
            <strong>{item.name}</strong>
            <small>{item.editionLabel}</small>
          </div>
          <span className="purchase-quantity">(x {item.quantity})</span>
          <strong className="price">{formatEth(item.lineTotal)} ETH</strong>
        </div>
      ))}
    </div>
  );
}
export function Totals({
  quote,
}: {
  quote: Pick<Quote, "subtotal" | "discount" | "networkFee" | "total">;
}) {
  return (
    <dl className="purchase-totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{formatEth(quote.subtotal)} ETH</dd>
      </div>
      <div>
        <dt>Desconto do lançamento</dt>
        <dd>(−) {formatEth(quote.discount)} ETH</dd>
      </div>
      <div>
        <dt>Taxa de rede</dt>
        <dd>
          {formatEth(quote.networkFee)} ETH<small>Taxa estimada</small>
        </dd>
      </div>
      <div className="purchase-total">
        <dt>Total</dt>
        <dd>{formatEth(quote.total)} ETH</dd>
      </div>
    </dl>
  );
}

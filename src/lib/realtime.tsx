import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import type {
  Cart,
  CatalogResponse,
  Nft,
  Order,
  RealtimeEvent,
} from "@/domain/types";
import { getToken, getVisitorId } from "./api";
import { useAuth } from "./auth";
import { VersionGate } from "./event-gate";
import { notify } from "@/components/ui/toast";

export function RealtimeSync() {
  const client = useQueryClient();
  const { user, isLoading } = useAuth();
  useEffect(() => {
    if (isLoading) return;
    const owner = user?.id ?? "guest";
    const gate = new VersionGate();
    let alive = true;
    let interrupted = false;
    const socket = io("https://realtime.kurio.test", {
      transports: ["websocket"],
      query: { token: getToken() ?? "", visitorId: getVisitorId() },
      auth: { token: getToken(), visitorId: getVisitorId() },
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 6000,
    });
    socket.on("connect", () => {
      if (!alive) return;
      void client.invalidateQueries({
        predicate: (q) =>
          ["catalog", "nft", "cart", "quote", "order"].includes(
            String(q.queryKey[0]),
          ),
      });
      if (interrupted)
        notify(
          "Conexão restabelecida. Sua coleção está atualizada.",
          "success",
        );
      interrupted = false;
    });
    socket.on("disconnect", () => {
      if (alive && !interrupted) {
        interrupted = true;
        notify("Conexão interrompida. Tentando reconectar…", "info");
      }
    });
    socket.on("nft.updated", (event: RealtimeEvent<Nft>) => {
      if (!alive || !event?.payload) return;
      const cached = client.getQueryData<Nft>(["nft", event.resourceId]);
      const catalogVersions = client
        .getQueriesData<CatalogResponse>({ queryKey: ["catalog"] })
        .flatMap(
          ([, v]) =>
            v?.items
              .filter((n) => n.id === event.resourceId)
              .map((n) => n.version) ?? [],
        );
      if (
        !gate.accept(
          "nft",
          event,
          Math.max(cached?.version ?? 0, ...catalogVersions),
        )
      )
        return;
      client.setQueryData(["nft", event.resourceId], event.payload);
      client.setQueriesData<CatalogResponse>(
        { queryKey: ["catalog"] },
        (previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.map((n) =>
                  n.id === event.resourceId ? event.payload : n,
                ),
              }
            : previous,
      );
      const cart = client.getQueryData<Cart>(["cart", owner]);
      if (cart?.items.some((item) => item.nftId === event.resourceId))
        notify(
          "O preço ou a disponibilidade de um NFT do carrinho mudou. Revise os valores.",
          "info",
        );
      void client.invalidateQueries({ queryKey: ["cart", owner] });
      void client.invalidateQueries({ queryKey: ["quote", owner] });
      void client.invalidateQueries({ queryKey: ["catalog"] });
    });
    socket.on("order.updated", (event: RealtimeEvent<Order>) => {
      if (!alive || event?.payload?.userId !== user?.id) return;
      const key = ["order", owner, event.resourceId];
      const cached = client.getQueryData<Order>(key);
      if (cached?.status === "confirmed" || cached?.status === "declined")
        return;
      if (!gate.accept("order", event, cached?.version ?? 0)) return;
      client.setQueryData(key, event.payload);
      void client.invalidateQueries({ queryKey: ["cart", owner] });
      void client.invalidateQueries({ queryKey: ["quote", owner] });
      if (event.payload.status === "confirmed")
        notify(
          "Compra confirmada! Seus NFTs estão na sua carteira.",
          "success",
        );
      if (event.payload.status === "declined")
        notify(
          "O pagamento foi recusado. Seus itens continuam no carrinho.",
          "error",
        );
    });
    return () => {
      alive = false;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [client, user?.id, isLoading]);
  return null;
}

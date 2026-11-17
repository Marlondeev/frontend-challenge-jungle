import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  RefreshCw,
  Wifi,
  WifiOff,
  TrendingUp,
  LogOut,
} from "lucide-react";
import type { DemoControl, Scenario } from "@/domain/types";
import { demoApi, errorMessage, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";

const scenarios: [Scenario, string][] = [
  ["success", "Funcionamento normal"],
  ["empty", "Nenhum resultado"],
  ["slow", "Conexão lenta"],
  ["variable-latency", "Respostas em tempos diferentes"],
  ["offline", "Falha de conexão"],
  ["server-error", "Serviço indisponível"],
  ["expired-session", "Sessão expirada"],
  ["validation-error", "Erro de validação"],
  ["invalid-coupon", "Cupom inválido"],
  ["expired-coupon", "Cupom expirado"],
  ["price-changed", "Preço alterado na compra"],
  ["sold-out", "Edição esgotada"],
  ["order-timeout", "Pagamento com resposta atrasada"],
  ["payment-declined", "Pagamento recusado"],
  ["favorite-error", "Falha ao favoritar"],
];
export function DemoTools() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["demo"],
    queryFn: demoApi.state,
    enabled: open,
    retry: false,
  });
  const control = useMutation({
    mutationFn: demoApi.control,
    onSuccess: (_data, input) => {
      if (input.action === "reset") {
        setToken(null);
        window.location.assign("/");
        return;
      }
      void client.invalidateQueries({ queryKey: ["demo"] });
      if (input.action === "scenario") {
        void client.invalidateQueries({
          predicate: (q) =>
            ["catalog", "cart", "quote"].includes(String(q.queryKey[0])),
        });
        notify(
          "Cenário selecionado. As próximas operações usarão essa condição.",
          "info",
        );
      }
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const act = (input: DemoControl) => control.mutate(input);
  return (
    <>
      <button
        className="demo-trigger"
        onClick={() => setOpen(true)}
        aria-label="Cenários da demonstração"
      >
        <FlaskConical size={13} />
        <span>Demonstração</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cenários da demonstração</DialogTitle>
            <DialogDescription>
              Experimente situações de compra e recuperação. Todos os pagamentos
              e carteiras são simulados.
            </DialogDescription>
          </DialogHeader>
          <div className="demo-grid">
            <label htmlFor="demo-scenario">Condição da simulação</label>
            <select
              id="demo-scenario"
              className="ui-input"
              value={state.data?.scenario ?? "success"}
              disabled={control.isPending}
              onChange={(e) =>
                act({
                  action: "scenario",
                  scenario: e.target.value as Scenario,
                })
              }
            >
              {scenarios.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="demo-help">
              Conta de exemplo: colecionador@kurio.test
              <br />
              Senha: Kurio123! · Cupom: KURIO10
            </p>
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() => act({ action: "nft-update" })}
            >
              <TrendingUp size={16} />
              Alterar preço do Emerald Ape
            </Button>
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() =>
                act({
                  action:
                    state.data?.connected === false
                      ? "reconnect"
                      : "disconnect",
                })
              }
            >
              {state.data?.connected === false ? (
                <Wifi size={16} />
              ) : (
                <WifiOff size={16} />
              )}{" "}
              {state.data?.connected === false
                ? "Restabelecer conexão"
                : "Interromper conexão"}
            </Button>
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() => act({ action: "duplicate" })}
            >
              Reenviar última atualização
            </Button>
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() => act({ action: "stale" })}
            >
              Enviar atualização antiga
            </Button>
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() => act({ action: "expire" })}
            >
              <LogOut size={16} />
              Expirar sessão
            </Button>
            <Button
              variant="secondary"
              disabled={control.isPending}
              onClick={() => act({ action: "reset" })}
            >
              <RefreshCw size={16} />
              Restaurar demonstração
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

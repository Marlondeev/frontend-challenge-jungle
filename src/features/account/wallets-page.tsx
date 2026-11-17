import { useState, type FormEvent } from "react";
import type { Wallet } from "@/domain/types";
import { useSaveWallet, useWallets } from "@/lib/hooks";
import { errorMessage, fieldErrors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { AccountShell, ErrorState, Field } from "./account-ui";
import "@/styles/account.css";

type Draft = Omit<Wallet, "id"> & { id?: string };
const emptyWallet = (): Draft => ({
  label: "",
  network: "Ethereum",
  address: "",
  provider: "MetaMask",
  primary: false,
  ens: "",
});
export function WalletsPage() {
  const wallets = useWallets();
  const save = useSaveWallet();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || save.isPending) return;
    const next: Record<string, string> = {};
    if (!draft.label.trim())
      next.label = "Informe um apelido para esta carteira.";
    if (
      !(
        draft.network === "Solana"
          ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
          : /^0x[a-fA-F0-9]{40}$/
      ).test(draft.address)
    )
      next.address =
        draft.network === "Solana"
          ? "Informe um endereço Solana válido (32 a 44 caracteres base58)."
          : "Informe um endereço com 0x seguido de 40 caracteres hexadecimais.";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({
        ...draft,
        label: draft.label.trim(),
        address: draft.address.trim(),
      });
      setDraft(null);
      notify("Carteira salva.", "success");
    } catch (error) {
      setErrors(fieldErrors(error));
      notify(errorMessage(error), "error");
    }
  }
  return (
    <AccountShell active="wallets">
      <div className="account-section-heading">
        <h1>Carteira principal</h1>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft({ ...emptyWallet(), primary: !wallets.data?.length });
            setErrors({});
          }}
        >
          Adicionar
        </Button>
      </div>
      <p className="muted">
        Estas carteiras ficam disponíveis no pagamento e para receber NFTs
        comprados.
      </p>
      {wallets.isPending ? (
        <p role="status">Carregando suas carteiras…</p>
      ) : wallets.isError ? (
        <ErrorState
          message={errorMessage(wallets.error)}
          retry={() => void wallets.refetch()}
        />
      ) : (
        <div className="saved-wallets">
          {wallets.data.map((wallet) => (
            <article className="saved-wallet" key={wallet.id}>
              <div>
                <h2>
                  {wallet.label}{" "}
                  {wallet.primary && (
                    <span className="wallet-badge">Principal</span>
                  )}
                </h2>
                <p>{wallet.ens || wallet.address}</p>
                <small>
                  {wallet.network} · {wallet.provider}
                </small>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft({ ...wallet });
                  setErrors({});
                }}
              >
                Editar
              </Button>
            </article>
          ))}
          {!wallets.data.length && (
            <p className="account-state">
              Você ainda não adicionou uma carteira.
            </p>
          )}
        </div>
      )}
      {draft && (
        <form noValidate onSubmit={submit} className="wallet-editor">
          <h2>{draft.id ? "Editar carteira" : "Adicionar carteira"}</h2>
          <div className="account-form-grid">
            <Field
              id="wallet-label"
              label="Apelido da carteira"
              required
              value={draft.label}
              error={errors.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
            <div className="account-field">
              <label htmlFor="wallet-network">
                Rede <span className="required">*</span>
              </label>
              <select
                id="wallet-network"
                value={draft.network}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    network: e.target.value as Wallet["network"],
                  })
                }
              >
                {["Ethereum", "Polygon", "Solana"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <Field
              id="wallet-address"
              label="Endereço da carteira"
              required
              placeholder="Endereço da carteira"
              value={draft.address}
              error={errors.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
            <div className="account-field">
              <label htmlFor="wallet-provider">
                Tipo de carteira <span className="required">*</span>
              </label>
              <select
                id="wallet-provider"
                value={draft.provider}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    provider: e.target.value as Wallet["provider"],
                  })
                }
              >
                {["MetaMask", "WalletConnect", "Coinbase Wallet"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <Field
              id="wallet-ens"
              label="Nome ENS (opcional)"
              placeholder="colecionador.eth"
              value={draft.ens ?? ""}
              error={errors.ens}
              onChange={(e) => setDraft({ ...draft, ens: e.target.value })}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.primary}
                onChange={(e) =>
                  setDraft({ ...draft, primary: e.target.checked })
                }
              />
              Usar como carteira principal
            </label>
          </div>
          <div className="form-actions">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar carteira"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <section className="secondary-wallet">
        <h2>Carteira secundária</h2>
        {wallets.data?.some((w) => !w.primary) ? (
          <p className="muted">
            Suas carteiras secundárias estão listadas acima.
          </p>
        ) : (
          <>
            <p className="muted">
              Você ainda não adicionou uma carteira secundária.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(emptyWallet());
                setErrors({});
              }}
            >
              Adicionar carteira secundária
            </Button>
          </>
        )}
      </section>
    </AccountShell>
  );
}

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  LogOut,
  UserRound,
  Wallet,
  Heart,
  Activity,
  LifeBuoy,
  Download,
  BadgeDollarSign,
  ChevronLeft,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { notify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Field({
  label,
  error,
  id,
  required,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <div className="account-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="required">*</span>}
      </label>
      <Input
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function PasswordField({
  label,
  error,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function PageHeading({
  title,
  back = "/",
  backHash,
  backLabel = "Voltar",
}: {
  title: string;
  back?: string;
  backHash?: string;
  backLabel?: string;
}) {
  return (
    <>
      <nav className="account-breadcrumb" aria-label="Caminho">
        <Link to="/">Início</Link>
        <span>/</span>
        <Link to="/" hash="mercado">
          Mercado
        </Link>
        <span>/</span>
        <span>{title}</span>
      </nav>
      <div className="purchase-mobile-heading">
        <Link to={back} hash={backHash} aria-label={backLabel}>
          <ChevronLeft />
        </Link>
        <h1>{title}</h1>
      </div>
    </>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="account-state" role="alert">
      <p>{message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
export function AccountShell({
  active,
  children,
}: {
  active: "profile" | "wallets";
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const unavailable = () =>
    notify("Esta área estará disponível em uma próxima versão.", "info");
  return (
    <div className="account-layout">
      <aside className="account-sidebar">
        <h2>Meu perfil</h2>
        <nav aria-label="Minha conta">
          <Link
            className={active === "profile" ? "selected" : ""}
            to="/account"
          >
            <UserRound size={18} />
            Dados do perfil
          </Link>
          <Link
            className={active === "wallets" ? "selected" : ""}
            to="/account/wallets"
          >
            <Wallet size={18} />
            Carteiras
          </Link>
          <button onClick={unavailable}>
            <Activity size={18} />
            Atividade
          </button>
          <Link to="/favorites">
            <Heart size={18} />
            Lista de interesse
          </Link>
          <button onClick={unavailable}>
            <BadgeDollarSign size={18} />
            Ofertas
          </button>
          <button onClick={unavailable}>
            <Download size={18} />
            Arquivos baixados
          </button>
          <button onClick={unavailable}>
            <LifeBuoy size={18} />
            Suporte
          </button>
          <button
            className="account-logout"
            onClick={async () => {
              try {
                await logout();
                await navigate({ to: "/" });
              } catch {
                notify("Não foi possível sair. Tente novamente.", "error");
              }
            }}
          >
            <LogOut size={18} />
            Sair
          </button>
        </nav>
      </aside>
      <section className="account-main">{children}</section>
    </div>
  );
}

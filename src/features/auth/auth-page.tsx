import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/auth";
import { errorMessage, fieldErrors } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { CatalogPage } from "@/features/catalog/catalog-page";
import { Field, PasswordField } from "@/features/account/account-ui";
import { validLocalRedirect } from "@/features/checkout/purchase-state";
import { SocialDemoButton } from "./social-demo-button";
import "@/styles/account.css";

const CartBackground = lazy(() =>
  import("@/features/cart/cart-page").then((module) => ({
    default: module.CartPage,
  })),
);

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
  const redirect = validLocalRedirect(search.redirect);
  const purchaseContext = /^\/(?:cart|checkout)(?:[?#]|$)/.test(redirect);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 769px)").matches,
  );
  const [values, setValues] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 769px)");
    const change = () => setDesktop(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    setErrors({});
    setFailure("");
    setPending(false);
    return () => {
      submission.current?.abort();
      submission.current = null;
    };
  }, [mode]);
  function update(key: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
      next.email = "Informe um e-mail válido.";
    if (!values.password) next.password = "Informe sua senha.";
    if (mode === "register") {
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(values.username))
        next.username = "Use de 3 a 24 letras, números, pontos ou traços.";
      if (
        values.password.length < 8 ||
        !/[A-Z]/.test(values.password) ||
        !/[0-9]/.test(values.password)
      )
        next.password = "Use 8 caracteres, uma letra maiúscula e um número.";
      if (values.confirmPassword !== values.password)
        next.confirmPassword = "As senhas não coincidem.";
    }
    setErrors(next);
    setFailure("");
    if (Object.keys(next).length) return;
    const attempt = new AbortController();
    submission.current?.abort();
    submission.current = attempt;
    setPending(true);
    try {
      if (mode === "login")
        await auth.login(
          { email: values.email.trim(), password: values.password },
          attempt.signal,
        );
      else
        await auth.register(
          { ...values, email: values.email.trim() },
          attempt.signal,
        );
      if (attempt.signal.aborted || submission.current !== attempt) return;
      await navigate({ to: redirect });
    } catch (error) {
      if (attempt.signal.aborted || submission.current !== attempt) return;
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error));
    } finally {
      if (submission.current === attempt) {
        submission.current = null;
        setPending(false);
      }
    }
  }
  const fields = (
    <>
      <div className="auth-brand">KURIO</div>
      <div className="auth-tabs">
        <Link
          to="/login"
          search={{ redirect: search.redirect }}
          className={mode === "login" ? "active" : ""}
        >
          Entrar
        </Link>
        <span>|</span>
        <Link
          to="/register"
          search={{ redirect: search.redirect }}
          className={mode === "register" ? "active" : ""}
        >
          Criar conta
        </Link>
      </div>
      <h1 className="auth-mobile-title">
        {mode === "login" ? "Entrar" : "Criar perfil de colecionador"}
      </h1>
      <p className="auth-description">
        {mode === "login"
          ? "Entre para gerenciar sua carteira, coleção e perfil de criador."
          : "Crie seu perfil de colecionador e conecte uma carteira quando quiser."}
      </p>
      <form noValidate onSubmit={submit} className="auth-form">
        {mode === "register" && (
          <Field
            id="auth-username"
            label="Nome de usuário"
            placeholder="Nome de usuário"
            autoComplete="username"
            value={values.username}
            onChange={(e) => update("username", e.target.value)}
            error={errors.username}
          />
        )}
        <Field
          id="auth-email"
          label="E-mail"
          placeholder={
            mode === "login" ? "contato@email.com" : "Digite seu e-mail"
          }
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          error={errors.email}
        />
        <PasswordField
          id="auth-password"
          label="Senha"
          placeholder="Senha"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={values.password}
          onChange={(e) => update("password", e.target.value)}
          error={errors.password}
        />
        {mode === "register" && (
          <PasswordField
            id="auth-confirm"
            label="Confirmar senha"
            placeholder="Confirmar senha"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={(e) => update("confirmPassword", e.target.value)}
            error={errors.confirmPassword}
          />
        )}
        {mode === "login" && (
          <button
            type="button"
            className="auth-recovery"
            onClick={() =>
              notify(
                "A recuperação por e-mail ainda não está disponível nesta demonstração. Use a conta de demonstração ou crie um perfil.",
                "info",
              )
            }
          >
            Esqueceu a senha?
          </button>
        )}
        {failure && (
          <p role="alert" className="field-error">
            {failure}
          </p>
        )}
        <Button className="auth-submit" disabled={pending} type="submit">
          {pending ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar perfil"}
        </Button>
      </form>
      <div className="auth-divider">
        <span>Ou continue com</span>
      </div>
      <div className="auth-social">
        {(["google", "facebook"] as const).map((provider) => (
          <SocialDemoButton
            key={provider}
            provider={provider}
            redirect={redirect}
          />
        ))}
      </div>
      {import.meta.env.VITE_MOCKS === "false" && (
        <p id="social-demo-unavailable" className="mt-3 text-xs text-secondary">
          O login social de demonstração está indisponível neste ambiente. O
          acesso a contas reais depende da configuração do Google e da Meta.
        </p>
      )}
      <p className="auth-switch">
        {mode === "login" ? "Novo na Kurio?" : "Já tem uma conta?"}{" "}
        <Link
          to={mode === "login" ? "/register" : "/login"}
          search={{ redirect: search.redirect }}
        >
          {mode === "login" ? "Crie uma conta" : "Entre"}
        </Link>
      </p>
    </>
  );
  return desktop ? (
    <>
      <div className="auth-background">
        {purchaseContext ? (
          <Suspense fallback={null}>
            <CartBackground />
          </Suspense>
        ) : (
          <CatalogPage />
        )}
      </div>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) {
            submission.current?.abort();
            void navigate({ to: purchaseContext ? "/cart" : "/" });
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="auth-overlay" />
          <Dialog.Content className="auth-dialog">
            <Dialog.Title className="sr-only">
              {mode === "login" ? "Entrar na Kurio" : "Criar conta Kurio"}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Acesse seu perfil de colecionador com e-mail e senha.
            </Dialog.Description>
            <Dialog.Close className="auth-close" aria-label="Fechar">
              <X size={19} />
            </Dialog.Close>
            {fields}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  ) : (
    <section className={`auth-mobile auth-${mode}`}>{fields}</section>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { SocialDemoProvider } from "@/domain/types";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { validLocalRedirect } from "@/features/checkout/purchase-state";

const profiles = {
  google: {
    label: "Google",
    profile: "Colecionador Kurio",
    logo: "G",
    index: 0,
  },
  facebook: {
    label: "Facebook",
    profile: "Nova Colecionadora",
    logo: "f",
    index: 1,
  },
} satisfies Record<
  SocialDemoProvider,
  { label: string; profile: string; logo: string; index: number }
>;

export function SocialDemoButton({
  provider,
  redirect,
}: {
  provider: SocialDemoProvider;
  redirect: string;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const submission = useRef<AbortController | null>(null);
  const available = import.meta.env.VITE_MOCKS !== "false";
  const profile = profiles[provider];

  useEffect(
    () => () => {
      submission.current?.abort();
      submission.current = null;
    },
    [],
  );

  function changeOpen(next: boolean) {
    if (!next) {
      submission.current?.abort();
      submission.current = null;
      setPending(false);
    }
    setFailure("");
    setOpen(next);
  }

  async function confirm() {
    if (pending || !available) return;
    const attempt = new AbortController();
    submission.current?.abort();
    submission.current = attempt;
    setPending(true);
    setFailure("");
    try {
      await auth.loginSocialDemo(provider, attempt.signal);
      if (attempt.signal.aborted || submission.current !== attempt) return;
      await navigate({ to: validLocalRedirect(redirect) });
    } catch (error) {
      if (!attempt.signal.aborted && submission.current === attempt)
        setFailure(errorMessage(error));
    } finally {
      if (submission.current === attempt) {
        submission.current = null;
        setPending(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={!available}
          aria-describedby={!available ? "social-demo-unavailable" : undefined}
        >
          <span
            aria-hidden="true"
            className={`social-logo social-${profile.index}`}
          >
            {profile.logo}
          </span>
          Continuar com {profile.label}
        </Button>
      </DialogTrigger>
      <DialogContent aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>Demonstração com {profile.label}</DialogTitle>
          <DialogDescription>
            Esta é uma simulação de login para o teste técnico. Nenhuma conta
            externa será acessada e nenhuma credencial do {profile.label} será
            solicitada.
          </DialogDescription>
        </DialogHeader>
        <p>
          Perfil fictício: <strong>{profile.profile}</strong>.
        </p>
        <p className="mt-3 text-sm text-secondary">
          Você poderá testar carrinho, favoritos e perfil com dados de
          demonstração.
        </p>
        {failure && (
          <p role="alert" className="field-error mt-3">
            {failure}
          </p>
        )}
        <DialogFooter className="flex-wrap">
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button disabled={pending} onClick={() => void confirm()}>
            {pending ? "Entrando…" : "Entrar na demonstração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

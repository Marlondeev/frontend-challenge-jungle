import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isCancel } from "axios";
import type { User } from "@/domain/types";
import { useAuth } from "@/lib/auth";
import { errorMessage, sessionApi } from "@/lib/api";
import {
  createGoogleCredentialRequest,
  loadGoogleIdentity,
  mountGoogleIdentityButton,
  pendingGoogleChallenge,
} from "@/lib/google-identity";
import { validLocalRedirect } from "@/features/checkout/purchase-state";

export function GoogleSignInButton({
  redirect,
  onAuthenticated,
  onStart,
}: {
  redirect: string;
  onAuthenticated?(user: User): void;
  onStart(): void;
}) {
  const { loginGoogle } = useAuth();
  const navigate = useNavigate();
  const host = useRef<HTMLDivElement>(null);
  const submission = useRef<AbortController | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const latest = useRef({ redirect, onAuthenticated, onStart, navigate });
  latest.current = { redirect, onAuthenticated, onStart, navigate };
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    let credentialRequest:
      ReturnType<typeof createGoogleCredentialRequest> | undefined;
    setLoading(true);
    if (!clientId) {
      setFailure("Configure o ID de cliente do Google para ativar este login.");
      setLoading(false);
      return;
    }
    async function prepare() {
      try {
        const [sdk, challenge] = await Promise.all([
          loadGoogleIdentity(),
          pendingGoogleChallenge(() => sessionApi.googleChallenge()),
        ]);
        if (!active || !host.current) return;
        release = mountGoogleIdentityButton(sdk, host.current, {
          clientId: clientId!,
          nonce: challenge.nonce,
          width: host.current.getBoundingClientRect().width || 320,
          credential: (response) => credentialRequest?.receive(response),
          click: () => {
            if (!active || submission.current) return;
            const attempt = new AbortController();
            submission.current = attempt;
            setPending(true);
            setFailure("");
            latest.current.onStart();
            // authenticate starts now, before the account chooser returns.
            void loginGoogle((signal) => {
              credentialRequest = createGoogleCredentialRequest(
                challenge.nonce,
                signal,
              );
              return credentialRequest.promise;
            }, attempt.signal)
              .then(async (user) => {
                if (
                  !active ||
                  attempt.signal.aborted ||
                  submission.current !== attempt
                )
                  return;
                if (latest.current.onAuthenticated)
                  latest.current.onAuthenticated(user);
                else
                  await latest.current.navigate({
                    to: validLocalRedirect(latest.current.redirect),
                  });
              })
              .catch((error: unknown) => {
                if (
                  !active ||
                  attempt.signal.aborted ||
                  submission.current !== attempt
                )
                  return;
                if (
                  isCancel(error) ||
                  (error instanceof Error && error.name === "AbortError")
                )
                  return;
                setFailure(errorMessage(error));
              })
              .finally(() => {
                credentialRequest = undefined;
                if (!active || submission.current !== attempt) return;
                submission.current = null;
                release?.();
                release = undefined;
                setPending(false);
                // Every used or canceled nonce is replaced before another click.
                setVersion((current) => current + 1);
              });
          },
        });
        setLoading(false);
      } catch (error) {
        if (!active) return;
        setFailure(errorMessage(error));
        setLoading(false);
      }
    }
    void prepare();
    return () => {
      active = false;
      submission.current?.abort();
      submission.current = null;
      credentialRequest = undefined;
      release?.();
    };
  }, [clientId, loginGoogle, version]);

  return (
    <div className="google-sign-in" aria-busy={loading || pending}>
      <div
        ref={host}
        className="google-sign-in-button"
        inert={pending || loading}
      />
      {loading && (
        <p role="status" className="google-sign-in-status">
          Preparando o Google…
        </p>
      )}
      {pending && (
        <div className="google-sign-in-progress">
          <p role="status">Conclua o login na janela do Google.</p>
          <button type="button" onClick={() => submission.current?.abort()}>
            Cancelar login do Google
          </button>
        </div>
      )}
      {failure && (
        <div className="google-sign-in-failure">
          <p role="alert" className="field-error">
            {failure}
          </p>
          {!loading && !pending && (
            <button
              type="button"
              onClick={() => {
                setFailure("");
                setVersion((current) => current + 1);
              }}
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}
    </div>
  );
}

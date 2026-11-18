import type { GoogleCredential } from "@/domain/types";

export interface GoogleCredentialResponse {
  credential?: string;
}

export interface GoogleIdentityConfiguration {
  client_id: string;
  nonce: string;
  callback(response: GoogleCredentialResponse): void;
  auto_select: false;
  button_auto_select: false;
  ux_mode: "popup";
}

export interface GoogleButtonConfiguration {
  type: "standard";
  theme: "filled_black";
  size: "large";
  text: "continue_with";
  shape: "rectangular";
  locale: "pt-BR";
  width: number;
  click_listener(): void;
}

export interface GoogleIdentityApi {
  initialize(configuration: GoogleIdentityConfiguration): void;
  renderButton(
    host: HTMLElement,
    configuration: GoogleButtonConfiguration,
  ): void;
  cancel?(): void;
}

type GoogleWindow = Window & {
  google?: { accounts?: { id?: GoogleIdentityApi } };
};

let scriptRequest: Promise<GoogleIdentityApi> | undefined;

/** Nothing is downloaded until the real-login component explicitly requests it. */
export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const available = (window as GoogleWindow).google?.accounts?.id;
  if (
    typeof available?.initialize === "function" &&
    typeof available.renderButton === "function"
  )
    return Promise.resolve(available);
  if (scriptRequest) return scriptRequest;
  const request = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "kurio-google-identity";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    const finish = (error?: Error) => {
      clearTimeout(deadline);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
      const sdk = (window as GoogleWindow).google?.accounts?.id;
      if (
        error ||
        typeof sdk?.initialize !== "function" ||
        typeof sdk.renderButton !== "function"
      ) {
        script.remove();
        reject(error ?? new Error("O Google não iniciou. Tente novamente."));
      } else resolve(sdk);
    };
    const loaded = () => finish();
    const failed = () =>
      finish(new Error("Não foi possível carregar o Google. Tente novamente."));
    const deadline = setTimeout(failed, 12_000);
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    document.head.appendChild(script);
  });
  scriptRequest = request;
  void request.catch(() => {
    if (scriptRequest === request) scriptRequest = undefined;
  });
  return request;
}

let challengeRequest: Promise<{ nonce: string }> | undefined;

/** StrictMode mounts share an in-flight cookie request, never a settled nonce. */
export function pendingGoogleChallenge(
  fetchChallenge: () => Promise<{ nonce: string }>,
): Promise<{ nonce: string }> {
  if (challengeRequest) return challengeRequest;
  const request = fetchChallenge().then((challenge) => {
    if (!challenge.nonce || challenge.nonce.length > 256)
      throw new Error("Não foi possível preparar o login. Tente novamente.");
    return challenge;
  });
  challengeRequest = request;
  void request.then(
    () => {
      if (challengeRequest === request) challengeRequest = undefined;
    },
    () => {
      if (challengeRequest === request) challengeRequest = undefined;
    },
  );
  return request;
}

export function createGoogleCredentialRequest(
  nonce: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
): {
  promise: Promise<GoogleCredential>;
  receive(response: GoogleCredentialResponse): void;
} {
  let receive: (response: GoogleCredentialResponse) => void = () => {};
  const promise = new Promise<GoogleCredential>((resolve, reject) => {
    let settled = false;
    const finish = (credential?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", canceled);
      if (error) reject(error);
      else resolve({ credential: credential!, nonce });
    };
    const canceled = () =>
      finish(undefined, new DOMException("Login cancelado", "AbortError"));
    const deadline = setTimeout(
      () =>
        finish(
          undefined,
          new Error("O login do Google não foi concluído. Tente novamente."),
        ),
      timeoutMs,
    );
    receive = (response) => {
      if (!response.credential || response.credential.length > 16_384) {
        finish(
          undefined,
          new Error(
            "O Google não enviou uma credencial válida. Tente novamente.",
          ),
        );
      } else finish(response.credential);
    };
    signal.addEventListener("abort", canceled, { once: true });
    if (signal.aborted) canceled();
  });
  return { promise, receive: (response) => receive(response) };
}

let activeConsumer: symbol | undefined;

/** GIS has global configuration: a released or superseded consumer stays silent. */
export function mountGoogleIdentityButton(
  sdk: GoogleIdentityApi,
  host: HTMLElement,
  options: {
    clientId: string;
    nonce: string;
    width: number;
    click(): void;
    credential(response: GoogleCredentialResponse): void;
  },
): () => void {
  const owner = Symbol("google-consumer");
  activeConsumer = owner;
  host.replaceChildren();
  sdk.initialize({
    client_id: options.clientId,
    nonce: options.nonce,
    auto_select: false,
    button_auto_select: false,
    ux_mode: "popup",
    callback: (response) => {
      if (activeConsumer === owner) options.credential(response);
    },
  });
  sdk.renderButton(host, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    locale: "pt-BR",
    width: Math.min(400, Math.max(200, Math.round(options.width))),
    click_listener: () => {
      if (activeConsumer === owner) options.click();
    },
  });
  return () => {
    if (activeConsumer !== owner) return;
    activeConsumer = undefined;
    sdk.cancel?.();
    host.replaceChildren();
  };
}

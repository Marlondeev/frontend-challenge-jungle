/** Hosted Google identities live only in this tab's fictional marketplace. */
export const isHostedGoogleDemo = () =>
  import.meta.env.VITE_GOOGLE_LOGIN === "vercel-demo";

export function getClientStorage(): Storage | undefined {
  if (isHostedGoogleDemo())
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function getStoredVisitorId(): string {
  const storage = getClientStorage();
  if (!storage)
    throw new Error("O armazenamento do navegador está indisponível.");
  let id = storage.getItem("kurio.visitor");
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem("kurio.visitor", id);
  }
  return id;
}

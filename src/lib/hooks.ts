import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Cart, CatalogSearch, Session } from "@/domain/types";
import {
  accountApi,
  cartApi,
  catalogApi,
  checkoutApi,
  favoritesApi,
  errorMessage,
} from "./api";
import { useAuth } from "./auth";
import { notify } from "@/components/ui/toast";

export function useCatalog(search: CatalogSearch = {}) {
  return useQuery({
    queryKey: ["catalog", search],
    queryFn: ({ signal }) => catalogApi.list(search, signal),
    placeholderData: keepPreviousData,
  });
}
export function useNft(id: string) {
  return useQuery({
    queryKey: ["nft", id],
    queryFn: ({ signal }) => catalogApi.detail(id, signal),
    enabled: !!id,
  });
}
export function useCart() {
  const { user, isLoading, error } = useAuth();
  return useQuery({
    queryKey: ["cart", user?.id ?? "guest"],
    queryFn: cartApi.get,
    enabled: !isLoading && !error,
  });
}
export function useQuote() {
  const { user } = useAuth();
  const cart = useCart();
  return useQuery({
    queryKey: [
      "quote",
      user?.id ?? "guest",
      cart.data?.version,
      cart.data?.coupon,
    ],
    queryFn: () => checkoutApi.quote(),
    enabled: !!cart.data?.items.length,
    staleTime: 0,
  });
}
export function useCartActions() {
  const { user } = useAuth();
  const client = useQueryClient();
  const owner = user?.id ?? "guest";
  const update = (cart: Cart) => {
    const current =
      client.getQueryData<Session>(["session"])?.user?.id ?? "guest";
    if (current !== owner) return;
    client.setQueryData(["cart", owner], cart);
    void client.invalidateQueries({ queryKey: ["quote", owner] });
  };
  const add = useMutation({ mutationFn: cartApi.add, onSuccess: update });
  const change = useMutation({ mutationFn: cartApi.update, onSuccess: update });
  const remove = useMutation({ mutationFn: cartApi.remove, onSuccess: update });
  const coupon = useMutation({ mutationFn: cartApi.coupon, onSuccess: update });
  return { add, update: change, remove, coupon };
}
export function useFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["favorites", user?.id ?? "guest"],
    queryFn: favoritesApi.list,
    enabled: !!user,
  });
}
export function useToggleFavorite() {
  const { user } = useAuth();
  const client = useQueryClient();
  const owner = user?.id ?? "guest";
  const key = ["favorites", owner];
  const current = () =>
    (client.getQueryData<Session>(["session"])?.user?.id ?? "guest") === owner;
  return useMutation({
    mutationFn: favoritesApi.set,
    onMutate: async ({ nftId, favorite }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<string[]>(key) ?? [];
      if (current())
        client.setQueryData(
          key,
          favorite
            ? [...new Set([...previous, nftId])]
            : previous.filter((id) => id !== nftId),
        );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context && current()) {
        client.setQueryData(key, context.previous);
        notify(errorMessage(error), "error");
      }
    },
    onSuccess: (data) => {
      if (current()) client.setQueryData(key, data);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
export function useWallets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["wallets", user?.id ?? "guest"],
    queryFn: accountApi.wallets,
    enabled: !!user,
  });
}
export function useSaveWallet() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: accountApi.saveWallet,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["wallets", user?.id] }),
  });
}
export function useUpdateProfile() {
  const client = useQueryClient();
  const { user: currentUser } = useAuth();
  const owner = currentUser?.id;
  return useMutation({
    mutationFn: accountApi.update,
    onSuccess: (user) => {
      if (client.getQueryData<Session>(["session"])?.user?.id !== owner) return;
      client.setQueryData<Session>(["session"], (previous) =>
        previous ? { ...previous, user } : { user, expiresAt: null },
      );
      client.setQueryData(["profile", user.id], user);
    },
  });
}
export function useChangePassword() {
  return useMutation({ mutationFn: accountApi.password });
}
export function useOrder(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["order", user?.id ?? "guest", id],
    queryFn: () => checkoutApi.order(id),
    enabled: !!user && !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 1200 : false,
  });
}

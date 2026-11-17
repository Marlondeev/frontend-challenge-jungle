import type { Artwork, Network, Nft, User, Wallet } from "../domain/types";
export const categories = [
  "Arte digital",
  "Fotografia",
  "Música",
  "Arte 3D",
  "Colecionáveis",
  "Generativa",
  "Jogos",
  "Assinaturas",
  "Utilidade",
];
const featured = [
  ["emerald-ape-042", "Emerald Ape #042", "green", "1.19"],
  ["sage-nomad-009", "Sage Nomad #009", "purple", "1.69"],
  ["neon-vessel-552", "Neon Vessel #552", "ivory", "1.99"],
  ["cosmic-bloom-118", "Cosmic Bloom #118", "purple", "1.29"],
  ["violet-nomad-314", "Violet Nomad #314", "purple", "1.39"],
  ["ivory-baron-088", "Ivory Baron #088", "ivory", "1.79"],
  ["golden-beat-207", "Golden Beat #207", "gold", "0.99"],
  ["golden-frequency-071", "Golden Frequency #071", "gold", "0.59"],
  ["golden-signal-160", "Golden Signal #160", "gold", "0.39"],
];
export function nftFixtures(): Nft[] {
  return Array.from({ length: 27 }, (_, index) => {
    const row = featured[index] ?? [
      `kurio-${index + 1}`,
      `${["Emerald", "Violet", "Ivory", "Golden"][index % 4]} Dreams #${String(index + 1).padStart(3, "0")}`,
      ["green", "purple", "ivory", "gold"][index % 4],
      `0.${25 + index * 3}`,
    ];
    return {
      id: row[0],
      name: row[1],
      artwork: row[2] as Artwork,
      price: row[3],
      ...(index === 2 ? { previousPrice: "2.29" } : {}),
      description:
        "Uma expressão única de arte e cultura digital. Cada edição faz parte de uma coleção independente, criada para quem vê o mundo de outro jeito.",
      collection: index % 2 ? "Kurio Originals" : "Bored Ape Collection",
      category: categories[index % categories.length],
      network: (["Ethereum", "Polygon", "Solana"] as Network[])[index % 3],
      editions: [
        { id: "one", label: "1/1", stock: 1 },
        { id: "ten", label: "1/10", stock: 10 },
        { id: "fifty", label: "1/50", stock: 50 },
        { id: "open", label: "ABERTA", stock: 100 },
      ],
      rarity: index % 3 ? "Raro" : "Lendário",
      rating: 4.8,
      reviews: 24 + index,
      version: 1,
      createdAt: new Date(Date.UTC(2026, 10, 17 - index)).toISOString(),
      trending: index % 3 === 0,
      isNew: index < 7,
    };
  });
}
export function userFixtures(): User[] {
  return [
    {
      id: "user-collector",
      email: "colecionador@kurio.test",
      username: "colecionador",
      displayName: "Colecionador Kurio",
      walletAlias: "Minha carteira",
      ens: "colecionador.eth",
      referralCode: "KURIO42",
    },
    {
      id: "user-nova",
      email: "nova@kurio.test",
      username: "nova",
      displayName: "Nova Colecionadora",
      walletAlias: "Carteira Nova",
      ens: "nova.eth",
      referralCode: "NOVA09",
    },
  ];
}
export function walletFixtures(userId: string): Wallet[] {
  return [
    {
      id: `${userId}-wallet-primary`,
      label: "Carteira principal",
      network: "Ethereum",
      address: `0x${userId === "user-collector" ? "42" : "09"}${"a".repeat(38)}`,
      provider: "MetaMask",
      primary: true,
      ens: userId === "user-collector" ? "colecionador.eth" : "nova.eth",
    },
    {
      id: `${userId}-wallet-secondary`,
      label: "Carteira secundária",
      network: "Polygon",
      address: `0x${userId === "user-collector" ? "55" : "66"}${"b".repeat(38)}`,
      provider: "WalletConnect",
      primary: false,
    },
  ];
}

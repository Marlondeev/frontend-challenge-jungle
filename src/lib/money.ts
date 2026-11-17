const UNIT = 10n ** 18n;
export function parseEth(value: string): bigint {
  if (!/^\d+(?:\.\d{1,18})?$/.test(value))
    throw new Error("Valor de ETH inválido.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, "0"));
}
export function fromWei(value: bigint): string {
  if (value < 0n) throw new Error("O valor não pode ser negativo.");
  const fraction = (value % UNIT)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return (value / UNIT).toString() + (fraction ? `.${fraction}` : "");
}
export function formatEth(value: string, maxDecimals = 18): string {
  const normalized = fromWei(parseEth(value));
  const [whole, fraction = ""] = normalized.split(".");
  const trimmed = fraction
    .slice(0, Math.max(0, Math.min(18, maxDecimals)))
    .replace(/0+$/, "");
  return whole + (trimmed ? `.${trimmed}` : "");
}
export function addEth(...values: string[]): string {
  return fromWei(values.reduce((total, value) => total + parseEth(value), 0n));
}
export function multiplyEth(value: string, quantity: number): string {
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new Error("Quantidade inválida.");
  return fromWei(parseEth(value) * BigInt(quantity));
}
export function compareEth(a: string, b: string): number {
  const left = parseEth(a),
    right = parseEth(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

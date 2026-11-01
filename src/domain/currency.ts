// Fraction digits an entered amount is rounded to: Sure's `default_precision` from
// config/currencies.yml (Sure 131e786), capped at 4 because Sure stores amounts as decimal(19,4).
// Intl's currency digits disagree with Sure's table, so it is not used. This is not
// `minor_unit_conversion`, which balance_cents uses and which differs for MGA, MRU and crypto.

const DEFAULT_SCALE = 2;

const SCALES = new Map<string, number>([
  ...[
    "BIF",
    "BYR",
    "CLP",
    "DJF",
    "GBX",
    "GNF",
    "HUF",
    "ISK",
    "JPY",
    "KMF",
    "KRW",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XAG",
    "XAU",
    "XBA",
    "XBB",
    "XBC",
    "XBD",
    "XDR",
    "XOF",
    "XPD",
    "XPF",
    "XPT",
    "XTS",
  ].map((code) => [code, 0] as const),
  ...["MGA", "MRU"].map((code) => [code, 1] as const),
  ...["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].map((code) => [code, 3] as const),
  ...["BTC", "CLF", "DOGE", "ETH"].map((code) => [code, 4] as const),
]);

/** `amountScale("JPY")` → `0`; a currency Sure does not list takes 2. */
export function amountScale(currency: string): number {
  return SCALES.get(currency) ?? DEFAULT_SCALE;
}

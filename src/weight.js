// Stored in kg, shown in stone/lb.
export const KG_PER_LB = 0.45359237;
export const LB_PER_ST = 14;

export function stLbToKg(st, lb = 0) {
  return (Number(st) * LB_PER_ST + Number(lb)) * KG_PER_LB;
}

/** Whole pounds: weights are shown and entered to the nearest lb (stored kg keeps whatever was saved). */
export const lbOf = (kg) => Math.round(kg / KG_PER_LB);

/** a − b in kg, worked out on the rounded pounds, so a change always matches the two weights shown. */
export const diffKg = (a, b) => (lbOf(a) - lbOf(b)) * KG_PER_LB;

/** kg → { st, lb } with whole lb. */
export function kgToStLb(kg) {
  const totalLb = lbOf(kg);
  const abs = Math.abs(totalLb);
  const st = Math.floor(abs / LB_PER_ST);
  const lb = abs - st * LB_PER_ST;
  return totalLb < 0 ? { st: -st, lb: -lb } : { st, lb };
}

/** '14 st 3 lb', '3 lb'. */
export function formatStLb(kg) {
  const { st, lb } = kgToStLb(Math.abs(kg));
  const lbStr = `${lb} lb`;
  const s = st ? `${st} st ${lbStr}` : lbStr;
  return kg < 0 ? `-${s}` : s;
}

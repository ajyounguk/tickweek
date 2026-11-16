// Stored in kg, shown in stone/lb.
export const KG_PER_LB = 0.45359237;
export const LB_PER_ST = 14;

export function stLbToKg(st, lb = 0) {
  return (Number(st) * LB_PER_ST + Number(lb)) * KG_PER_LB;
}

/** kg → { st, lb } with lb rounded to 0.1 (carrying 14.0 lb into the next stone). */
export function kgToStLb(kg) {
  const totalLb = Math.round((kg / KG_PER_LB) * 10) / 10;
  const neg = totalLb < 0;
  const abs = Math.abs(totalLb);
  let st = Math.floor(abs / LB_PER_ST);
  let lb = Math.round((abs - st * LB_PER_ST) * 10) / 10;
  if (lb >= LB_PER_ST) { st += 1; lb = 0; }
  return { st: neg ? -st : st, lb: neg ? -lb : lb };
}

/** '14 st 3.4 lb', '3.4 lb', '1 st 2 lb' (drops a trailing .0). */
export function formatStLb(kg) {
  const { st, lb } = kgToStLb(Math.abs(kg));
  const lbStr = `${Number.isInteger(lb) ? lb : lb.toFixed(1)} lb`;
  const s = st ? `${st} st ${lbStr}` : lbStr;
  return kg < 0 ? `-${s}` : s;
}

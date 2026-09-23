// All money is integer cents.
export const cents = (dollars: number) => Math.round(dollars * 100);
export const format = (c: number) => `$${(c / 100).toFixed(2)}`;

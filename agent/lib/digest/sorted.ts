/**
 * A sorted copy of a list.
 *
 * @remarks
 * `Array#toSorted` is what the lint rule asks for, but `tsconfig.json`
 * targets ES2022, whose library does not declare it. Copying first keeps the
 * input untouched, which is all the rule is after.
 */
export const sorted = <T>(
  items: readonly T[],
  compare: (left: T, right: T) => number
): T[] =>
  // oxlint-disable-next-line unicorn/no-array-sort -- the copy on this line is the non-mutating sort the rule wants
  [...items].sort(compare);

/** Code-unit order, so the same strings sort the same way on every runtime. */
export const compareText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

export type LineChanges = { removed: Set<number>; added: Set<number> };

/** Line-level review markers. Unique matching lines anchor independent edits. */
export function lineChanges(before: string, after: string): LineChanges {
  const left = before === "" ? [] : before.split("\n");
  const right = after === "" ? [] : after.split("\n");
  const removed = new Set<number>();
  const added = new Set<number>();
  const compare = (
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
  ) => {
    while (aStart < aEnd && bStart < bEnd && left[aStart] === right[bStart]) {
      aStart++;
      bStart++;
    }
    while (
      aStart < aEnd &&
      bStart < bEnd &&
      left[aEnd - 1] === right[bEnd - 1]
    ) {
      aEnd--;
      bEnd--;
    }
    if (aStart === aEnd || bStart === bEnd) {
      for (let i = aStart; i < aEnd; i++) removed.add(i + 1);
      for (let i = bStart; i < bEnd; i++) added.add(i + 1);
      return;
    }
    const leftCounts = new Map<string, number>();
    const rightCounts = new Map<string, number>();
    const leftPositions = new Map<string, number>();
    for (let i = aStart; i < aEnd; i++) {
      leftCounts.set(left[i], (leftCounts.get(left[i]) || 0) + 1);
      leftPositions.set(left[i], i);
    }
    for (let i = bStart; i < bEnd; i++)
      rightCounts.set(right[i], (rightCounts.get(right[i]) || 0) + 1);
    const candidates: { a: number; b: number }[] = [];
    for (let i = bStart; i < bEnd; i++)
      if (leftCounts.get(right[i]) === 1 && rightCounts.get(right[i]) === 1)
        candidates.push({ a: leftPositions.get(right[i])!, b: i });
    // A longest increasing subsequence keeps matching lines in source order.
    const tails: number[] = [];
    const predecessors = new Array<number>(candidates.length).fill(-1);
    for (let i = 0; i < candidates.length; i++) {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (candidates[tails[middle]].a < candidates[i].a) low = middle + 1;
        else high = middle;
      }
      if (low) predecessors[i] = tails[low - 1];
      tails[low] = i;
    }
    if (!tails.length) {
      for (let i = aStart; i < aEnd; i++) removed.add(i + 1);
      for (let i = bStart; i < bEnd; i++) added.add(i + 1);
      return;
    }
    const anchors: { a: number; b: number }[] = [];
    for (let i = tails.at(-1)!; i >= 0; i = predecessors[i])
      anchors.push(candidates[i]);
    anchors.reverse();
    let previousA = aStart;
    let previousB = bStart;
    for (const anchor of anchors) {
      compare(previousA, anchor.a, previousB, anchor.b);
      previousA = anchor.a + 1;
      previousB = anchor.b + 1;
    }
    compare(previousA, aEnd, previousB, bEnd);
  };
  compare(0, left.length, 0, right.length);
  return { removed, added };
}

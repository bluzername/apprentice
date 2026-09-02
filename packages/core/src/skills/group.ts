export interface TokenEntry {
  readonly token: string;
  readonly ts: number;
  readonly context: string;
}

export interface TokenGroup {
  readonly context: string;
  readonly entries: readonly TokenEntry[];
}

export const MIN_SUBTASKS = 3;
export const MAX_SUBTASKS = 12;
const TINY_GROUP_SIZE = 1;

function mergeInto(groups: readonly TokenGroup[], from: number, into: number): TokenGroup[] {
  const source = groups[from]!;
  const target = groups[into]!;
  const merged: TokenGroup = {
    context: target.entries.length >= source.entries.length ? target.context : source.context,
    entries: from < into ? [...source.entries, ...target.entries] : [...target.entries, ...source.entries]
  };
  return groups.map((group, index) => (index === into ? merged : group)).filter((_, index) => index !== from);
}

function mergeTinyGroups(groups: readonly TokenGroup[]): TokenGroup[] {
  let current = [...groups];
  let index = 0;
  while (index < current.length && current.length > 1) {
    if (current[index]!.entries.length <= TINY_GROUP_SIZE) {
      const into = index > 0 ? index - 1 : index + 1;
      current = mergeInto(current, index, into);
      index = Math.max(0, index - 1);
    } else {
      index += 1;
    }
  }
  return current;
}

function mergeSmallestUntil(groups: readonly TokenGroup[], max: number): TokenGroup[] {
  let current = [...groups];
  while (current.length > max) {
    let smallest = 0;
    current.forEach((group, index) => {
      if (group.entries.length < current[smallest]!.entries.length) smallest = index;
    });
    const left = current[smallest - 1];
    const right = current[smallest + 1];
    const into = left === undefined ? smallest + 1 : right === undefined ? smallest - 1 : left.entries.length <= right.entries.length ? smallest - 1 : smallest + 1;
    current = mergeInto(current, smallest, into);
  }
  return current;
}

function splitLargestUntil(groups: readonly TokenGroup[], min: number): TokenGroup[] {
  let current = [...groups];
  while (current.length < min) {
    let largest = 0;
    current.forEach((group, index) => {
      if (group.entries.length > current[largest]!.entries.length) largest = index;
    });
    const group = current[largest]!;
    if (group.entries.length < 2) break;
    const half = Math.ceil(group.entries.length / 2);
    const first: TokenGroup = { context: group.context, entries: group.entries.slice(0, half) };
    const second: TokenGroup = { context: group.context, entries: group.entries.slice(half) };
    current = [...current.slice(0, largest), first, second, ...current.slice(largest + 1)];
  }
  return current;
}

/** Groups consecutive entries by app/domain, merges tiny groups, and bounds the count to [min, max]. */
export function groupByContext(entries: readonly TokenEntry[], bounds: { min?: number; max?: number } = {}): TokenGroup[] {
  const min = bounds.min ?? MIN_SUBTASKS;
  const max = bounds.max ?? MAX_SUBTASKS;
  if (entries.length === 0) return [];
  const raw = entries.reduce<TokenGroup[]>((groups, entry) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.context === entry.context) {
      return [...groups.slice(0, -1), { context: last.context, entries: [...last.entries, entry] }];
    }
    return [...groups, { context: entry.context, entries: [entry] }];
  }, []);
  return splitLargestUntil(mergeSmallestUntil(mergeTinyGroups(raw), max), min);
}

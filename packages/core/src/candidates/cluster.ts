/** Greedy clustering: each unassigned episode seeds a cluster of episodes similar to it and to its members. */
export function clusterBySimilarity(matrix: readonly (readonly number[])[], threshold: number): number[][] {
  const assigned = new Set<number>();
  const clusters: number[][] = [];
  for (let seed = 0; seed < matrix.length; seed += 1) {
    if (assigned.has(seed)) continue;
    const members = [seed];
    assigned.add(seed);
    for (let other = seed + 1; other < matrix.length; other += 1) {
      if (assigned.has(other)) continue;
      const toSeed = matrix[seed]?.[other] ?? 0;
      if (toSeed < threshold) continue;
      const toMembers = members.map((member) => matrix[member]?.[other] ?? 0);
      const mean = toMembers.reduce((sum, value) => sum + value, 0) / toMembers.length;
      if (mean >= threshold) {
        members.push(other);
        assigned.add(other);
      }
    }
    clusters.push(members);
  }
  return clusters;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

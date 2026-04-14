export function createEmptyFunnelAttribution() {
  return {
    signups: createEmptyStageCounts(),
    invited: createEmptyStageCounts(),
    blocked: createEmptyStageCounts(),
    athleteShown: createEmptyStageCounts(),
    paid: createEmptyStageCounts(),
  };
}

export function toFunnelCohort(attributionType) {
  if (attributionType === "tracked_paid") return "tracked";
  if (attributionType === "inferred_paid") return "inferred";
  return "nonPaid";
}

export function incrementFunnelAttribution(
  funnelAttribution,
  {attributionType, invited = false, blocked = false, athleteShown = false, paid = false},
) {
  const cohort = toFunnelCohort(attributionType);
  funnelAttribution.signups[cohort] += 1;
  if (invited) funnelAttribution.invited[cohort] += 1;
  if (blocked) funnelAttribution.blocked[cohort] += 1;
  if (athleteShown) funnelAttribution.athleteShown[cohort] += 1;
  if (paid) funnelAttribution.paid[cohort] += 1;
  return funnelAttribution;
}

export function computeCohortRate(numeratorCounts, denominatorCounts, cohort) {
  const denominator = denominatorCounts?.[cohort] || 0;
  if (denominator <= 0) return null;
  return (numeratorCounts?.[cohort] || 0) / denominator;
}

function createEmptyStageCounts() {
  return {
    tracked: 0,
    inferred: 0,
    nonPaid: 0,
  };
}

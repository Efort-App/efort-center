function cleanString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function resolveInternalResultCount({
  optimizationEvent,
  cookieAcceptedSignups,
  cookieAcceptedPowerliftersSelected,
}) {
  const normalizedEvent = cleanString(optimizationEvent);
  if (normalizedEvent === "COMPLETE_REGISTRATION") {
    return Number.isFinite(Number(cookieAcceptedSignups)) ? Number(cookieAcceptedSignups) : 0;
  }
  if (normalizedEvent === "OTHER") {
    return Number.isFinite(Number(cookieAcceptedPowerliftersSelected)) ?
      Number(cookieAcceptedPowerliftersSelected) :
      0;
  }
  return null;
}

export function resolveInternalCostPerResult({hasMetaAttributionLink, spend, resultCount}) {
  if (!hasMetaAttributionLink) return null;
  const normalizedResultCount =
    Number.isFinite(Number(resultCount)) ? Number(resultCount) : null;
  if (normalizedResultCount === null || normalizedResultCount <= 0) return null;
  return Number.isFinite(Number(spend)) ? Number(spend) / normalizedResultCount : null;
}

export function rollupAdsetResultMetrics(adsetRow, childAdRows) {
  const children = Array.isArray(childAdRows) ? childAdRows : [];
  let hasResolvedChildResult = false;
  let rolledResultCount = 0;

  for (const child of children) {
    if (child?.result_count === null || child?.result_count === undefined) continue;
    const numericValue = Number(child.result_count);
    if (!Number.isFinite(numericValue)) continue;
    hasResolvedChildResult = true;
    rolledResultCount += numericValue;
  }

  if (!hasResolvedChildResult) {
    return adsetRow;
  }

  return {
    ...adsetRow,
    result_count: rolledResultCount,
    cost_per_result: resolveInternalCostPerResult({
      hasMetaAttributionLink: adsetRow?.hasMetaAttributionLink,
      spend: adsetRow?.spend,
      resultCount: rolledResultCount,
    }),
  };
}

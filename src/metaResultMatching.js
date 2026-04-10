function cleanString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeToken(value) {
  const normalized = cleanString(value);
  return normalized ? normalized.toLowerCase().replace(/[^a-z0-9]+/g, "") : null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function pushUniqueCandidate(target, value) {
  const normalized = normalizeToken(value);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
}

export function buildOptimizationMetricCandidates({optimizationEvent, customConversionId}) {
  const candidates = [];
  pushUniqueCandidate(candidates, customConversionId);

  const eventToken = normalizeToken(optimizationEvent);
  if (eventToken) {
    pushUniqueCandidate(candidates, eventToken);
    pushUniqueCandidate(candidates, `offsite_conversion.${eventToken}`);
    pushUniqueCandidate(candidates, `offsite_conversion.fb_pixel_${eventToken}`);
    pushUniqueCandidate(candidates, `omni_${eventToken}`);
  }

  return candidates;
}

export function extractMetricValue(rawMetric, candidateTokens) {
  const candidates = candidateTokens.filter(Boolean);
  if (candidates.length === 0) return null;

  if (Array.isArray(rawMetric)) {
    for (const entry of rawMetric) {
      if (!entry || typeof entry !== "object") continue;
      const actionType = normalizeToken(entry.action_type);
      if (!actionType) continue;
      if (candidates.some((candidate) => actionType.includes(candidate))) {
        return toNullableNumber(entry.value);
      }
    }
    return null;
  }

  if (rawMetric && typeof rawMetric === "object") {
    const actionType = normalizeToken(rawMetric.action_type);
    if (actionType && candidates.some((candidate) => actionType.includes(candidate))) {
      return toNullableNumber(rawMetric.value);
    }
  }

  return null;
}

export function extractOptimizationMetrics(raw, optimizationEvent, customConversionId) {
  const candidates = buildOptimizationMetricCandidates({optimizationEvent, customConversionId});
  return {
    result_count:
      extractMetricValue(raw.actions, candidates) ??
      extractMetricValue(raw.conversions, candidates),
    cost_per_result:
      extractMetricValue(raw.cost_per_action_type, candidates) ??
      extractMetricValue(raw.cost_per_conversion, candidates),
  };
}

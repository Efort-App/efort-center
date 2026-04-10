function cleanString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function resolveOptimizationEventLabel(source) {
  if (!source || typeof source !== "object") return null;

  const explicitEvent = cleanString(source.optimization_event);
  if (explicitEvent) return explicitEvent;

  const customConversionName = cleanString(source.custom_conversion_name);
  if (customConversionName) return customConversionName;

  const promotedObject =
    source.promoted_object && typeof source.promoted_object === "object"
      ? source.promoted_object
      : null;

  const customEventType = cleanString(promotedObject?.custom_event_type);
  if (customEventType) return customEventType;

  return cleanString(source.optimization_goal);
}

export function formatCallToActionText(value) {
  const normalized = cleanString(value);
  if (!normalized) return null;
  if (!normalized.includes("_")) return normalized;

  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

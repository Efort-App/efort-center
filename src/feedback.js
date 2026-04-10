function readText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSource(value) {
  return readText(value).toUpperCase();
}

function readCoachId(record) {
  return readText(record?.coach_id ?? record?.coachId);
}

export function resolveFeedbackText(record) {
  if (!record || typeof record !== "object") return "";

  for (const field of ["text", "feedback", "message", "content"]) {
    const text = readText(record[field]);
    if (text) {
      const source = normalizeSource(record.source);
      return source ? `[${source}] ${text}` : text;
    }
  }

  return "";
}

export function resolveTimestampMillis(value) {
  if (value === undefined || value === null) return 0;

  if (typeof value.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    const millis = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(millis) ? millis : 0;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : 0;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && value !== "") {
      return numericValue < 1e12 ? numericValue * 1000 : numericValue;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function formatFeedbackTimestampCsv(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  return new Date(timestampMs).toISOString();
}

export function normalizeFeedbackEntry(record, index = 0) {
  const timestampValue =
    record?.timestamp ?? record?.createdAt ?? record?.created_at ?? record?.updatedAt ?? null;
  const rawText = readText(
    record?.text ?? record?.feedback ?? record?.message ?? record?.content,
  );
  const source = readText(record?.source);

  return {
    id: readText(record?.id) || `feedback-${index}`,
    source,
    text: rawText,
    displayText: resolveFeedbackText(record),
    coach_id: readCoachId(record),
    timestampMs: resolveTimestampMillis(timestampValue),
  };
}

export function normalizeFeedbackEntries(records) {
  if (!Array.isArray(records)) return [];

  return records
    .map((record, index) => normalizeFeedbackEntry(record, index))
    .filter((record) => record.text)
    .sort((left, right) => right.timestampMs - left.timestampMs);
}

export function formatFeedbackTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "Unknown date";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

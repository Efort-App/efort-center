const ATHLETE_TYPE_KEYS = ["powerlifters", "bodybuilders", "other"];

const ATHLETE_TYPE_ALIASES = {
  powerlifters: "powerlifters",
  powerlifter: "powerlifters",
  "power lifters": "powerlifters",
  "power lifter": "powerlifters",
  power_lifters: "powerlifters",
  bodybuilders: "bodybuilders",
  bodybuilder: "bodybuilders",
  "body builders": "bodybuilders",
  "body builder": "bodybuilders",
  body_builders: "bodybuilders",
  other: "other",
};

function normalizeAthleteTypeValue(value) {
  if (value === undefined || value === null) return null;
  const base = String(value).trim().toLowerCase();
  if (!base) return null;

  if (ATHLETE_TYPE_ALIASES[base]) return ATHLETE_TYPE_ALIASES[base];

  const collapsed = base.replace(/[\s_-]+/g, "");
  if (collapsed === "powerlifters" || collapsed === "powerlifter") {
    return "powerlifters";
  }
  if (collapsed === "bodybuilders" || collapsed === "bodybuilder") {
    return "bodybuilders";
  }
  if (collapsed === "other") {
    return "other";
  }
  return null;
}

export function normalizeAthleteTypes(rawAthleteTypes) {
  let source = [];
  if (Array.isArray(rawAthleteTypes)) {
    source = rawAthleteTypes;
  } else if (typeof rawAthleteTypes === "string") {
    source = rawAthleteTypes
      .split(/[,\n;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const normalized = new Set();
  for (const value of source) {
    const type = normalizeAthleteTypeValue(value);
    if (type) normalized.add(type);
  }

  return ATHLETE_TYPE_KEYS.filter((key) => normalized.has(key));
}

export function computeAthleteTypeDistribution(records) {
  const counts = {
    powerlifters: 0,
    bodybuilders: 0,
    other: 0,
  };

  let respondingCoaches = 0;
  let excludedMissing = 0;
  let totalResponses = 0;

  for (const record of records || []) {
    const normalizedTypes = normalizeAthleteTypes(record?.onboarding_athletes_types);
    if (normalizedTypes.length === 0) {
      excludedMissing += 1;
      continue;
    }

    respondingCoaches += 1;
    for (const type of normalizedTypes) {
      counts[type] += 1;
      totalResponses += 1;
    }
  }

  const ratios = {
    powerlifters: totalResponses > 0 ? counts.powerlifters / totalResponses : null,
    bodybuilders: totalResponses > 0 ? counts.bodybuilders / totalResponses : null,
    other: totalResponses > 0 ? counts.other / totalResponses : null,
  };

  return {
    counts,
    ratios,
    totalResponses,
    respondingCoaches,
    excludedMissing,
  };
}

function toDateKey(value) {
  if (!value) return null;

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const dateValue = typeof value.toDate === "function" ? value.toDate() : value;
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return dateValue.toISOString().slice(0, 10);
  }

  return null;
}

export function computeAthleteTypeDailyDistribution(records, getDateValue) {
  const byDate = new Map();

  for (const record of records || []) {
    const dateValue = getDateValue ? getDateValue(record) : record?.trial_period_start_date;
    const dateKey = toDateKey(dateValue);
    if (!dateKey) continue;

    const normalizedTypes = normalizeAthleteTypes(record?.onboarding_athletes_types);
    if (normalizedTypes.length === 0) continue;

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        counts: {
          powerlifters: 0,
          bodybuilders: 0,
          other: 0,
        },
        totalResponses: 0,
      });
    }

    const row = byDate.get(dateKey);
    for (const type of normalizedTypes) {
      row.counts[type] += 1;
      row.totalResponses += 1;
    }
  }

  const labels = Array.from(byDate.keys()).sort();
  const powerlifters = [];
  const bodybuilders = [];
  const other = [];
  const powerliftersCounts = [];
  const bodybuildersCounts = [];
  const otherCounts = [];
  const totalResponsesByDate = [];

  for (const dateKey of labels) {
    const row = byDate.get(dateKey);
    const total = row.totalResponses;
    powerliftersCounts.push(row.counts.powerlifters);
    bodybuildersCounts.push(row.counts.bodybuilders);
    otherCounts.push(row.counts.other);
    totalResponsesByDate.push(total);
    powerlifters.push(total > 0 ? (row.counts.powerlifters / total) * 100 : 0);
    bodybuilders.push(total > 0 ? (row.counts.bodybuilders / total) * 100 : 0);
    other.push(total > 0 ? (row.counts.other / total) * 100 : 0);
  }

  return {
    labels,
    powerlifters,
    bodybuilders,
    other,
    powerliftersCounts,
    bodybuildersCounts,
    otherCounts,
    totalResponsesByDate,
  };
}

function classifyCoachAthleteTypeSelection(normalizedTypes) {
  const hasPowerlifters = normalizedTypes.includes("powerlifters");
  const hasBodybuilders = normalizedTypes.includes("bodybuilders");
  const hasOther = normalizedTypes.includes("other");

  if (hasPowerlifters && !hasBodybuilders && !hasOther) {
    return "onlyPowerlifting";
  }
  if (!hasPowerlifters && hasBodybuilders && !hasOther) {
    return "onlyBodybuilding";
  }
  if (hasPowerlifters && hasBodybuilders && !hasOther) {
    return "powerliftingAndBodybuilding";
  }
  if (hasOther) {
    return "other";
  }

  return null;
}

export function computeAthleteTypeDailyCoachMix(records, getDateValue) {
  const byDate = new Map();

  for (const record of records || []) {
    const dateValue = getDateValue ? getDateValue(record) : record?.trial_period_start_date;
    const dateKey = toDateKey(dateValue);
    if (!dateKey) continue;

    const normalizedTypes = normalizeAthleteTypes(record?.onboarding_athletes_types);
    if (normalizedTypes.length === 0) continue;

    const coachBucket = classifyCoachAthleteTypeSelection(normalizedTypes);
    if (!coachBucket) continue;

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        onlyPowerlifting: 0,
        onlyBodybuilding: 0,
        powerliftingAndBodybuilding: 0,
        other: 0,
      });
    }

    byDate.get(dateKey)[coachBucket] += 1;
  }

  const labels = Array.from(byDate.keys()).sort();
  const onlyPowerlifting = [];
  const onlyBodybuilding = [];
  const powerliftingAndBodybuilding = [];
  const other = [];

  for (const dateKey of labels) {
    const row = byDate.get(dateKey);
    onlyPowerlifting.push(row.onlyPowerlifting || 0);
    onlyBodybuilding.push(row.onlyBodybuilding || 0);
    powerliftingAndBodybuilding.push(row.powerliftingAndBodybuilding || 0);
    other.push(row.other || 0);
  }

  return {
    labels,
    onlyPowerlifting,
    onlyBodybuilding,
    powerliftingAndBodybuilding,
    other,
  };
}

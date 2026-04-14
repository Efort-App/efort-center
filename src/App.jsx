import {useEffect, useMemo, useState} from "react";
import {onAuthStateChanged, signInWithPopup, signOut} from "firebase/auth";
import {httpsCallable} from "firebase/functions";
import {collection, getDocs, query, where} from "firebase/firestore";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import {Bar, Line} from "react-chartjs-2";
import {auth, db, functions, googleProvider} from "./firebase";
import {hasDashboardAccess} from "./accessControl";
import {
  computeAthleteTypeDailyCoachMix,
  computeAthleteTypeDailyDistribution,
  normalizeAthleteTypes,
} from "./athleteTypeDistribution";
import FeedbackPage from "./FeedbackPage";
import TasksPage from "./TasksPage";
import {buildAssetBaseName, downloadAssetZip} from "./assetExport";
import {formatCallToActionText, resolveOptimizationEventLabel} from "./metaAdEnrichment";
import {
  rollupAdsetResultMetrics,
  resolveInternalCostPerResult,
  resolveInternalResultCount,
} from "./resultMetrics";
import {downloadCsv} from "./tableExport";
import {
  computeCohortRate,
  createEmptyFunnelAttribution,
  incrementFunnelAttribution,
} from "./funnelAttribution";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
);

const META_CALLABLE_NAME = "getMetaInsights";
const META_CACHE_TTL_MS = 20 * 60 * 1000;
const META_CACHE_ENABLED = true;

const palette = {
  brand: "#3f7b8d",
  accent: "#5e6ad2",
  success: "#46b97b",
  warn: "#e0aa52",
  rose: "#e26e9f",
  slate: "#64748b",
  ink: "#171717",
  muted: "#94a3b8",
  grid: "rgba(0, 0, 0, 0.06)",
};

const priceCatalog = {
  // Monthly plan value by Stripe price ID (EUR).
  price_1QCT5RIu8R9ZwWzDlS6Dq1K8: 9.99,
  price_1QCT96Iu8R9ZwWzDMFogwnoT: 24.99,
  price_1QCTAyIu8R9ZwWzDs7YtVGFZ: 39.99,
  price_1QCTBcIu8R9ZwWzDimrWzyDa: 59.99,
  price_1QCTCEIu8R9ZwWzDCKfLiJIk: 89.99,
};

// Optional bridge if your UTM values are names while Meta payload uses IDs.
const adKeyAliases = {};
const adsetKeyAliases = {};
const campaignKeyAliases = {};
const INFERRED_PAID_UNKNOWN = "inferred_paid_unknown";
const UNKNOWN_ADSET = "unknown_adset";
const INFERRED_PAID_COUNTRY_CODES = new Set(["US", "GB"]);
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return "-";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "-";
  return numberValue.toFixed(digits);
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined) return "-";
  return `${formatNumber(value * 100, digits)}%`;
}

function formatCurrency(value, digits = 0, currency = "EUR") {
  if (value === null || value === undefined) return "-";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numberValue);
}

function readNullableString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function readNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatMetaResultCountValue(value) {
  const numberValue = readNullableNumber(value);
  return numberValue === null ? "-" : Math.round(numberValue).toLocaleString();
}

function formatMetaDateTime(value, timezone) {
  const normalized = readNullableString(value);
  if (!normalized) return "-";

  let dateValue;
  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized);
    const milliseconds = normalized.length <= 10 ? numericValue * 1000 : numericValue;
    dateValue = new Date(milliseconds);
  } else {
    dateValue = new Date(normalized);
  }

  if (Number.isNaN(dateValue.getTime())) return normalized;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone || undefined,
  }).format(dateValue);
}

function formatMetaEndTime(value, timezone) {
  return readNullableString(value) ? formatMetaDateTime(value, timezone) : "Ongoing";
}

function readStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readNullableString(item)).filter(Boolean);
}

function getCurrencyMinorUnitDivisor(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
}

function formatMinorUnitCurrency(value, currency = "EUR", digits = 2) {
  if (value === null || value === undefined) return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "-";
  return formatCurrency(numberValue / getCurrencyMinorUnitDivisor(currency), digits, currency);
}

function formatListValue(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "-";
}

function formatListCsv(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(" | ") : "";
}

function renderTrackedInferredSummary(counts) {
  return (
    <>
      Tracked: {(counts?.tracked || 0).toLocaleString()}
      <br />
      Inferred: {(counts?.inferred || 0).toLocaleString()}
    </>
  );
}

function formatAttributionSpecValue(specs) {
  if (!Array.isArray(specs) || specs.length === 0) return "-";
  const parts = specs
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const eventType = readNullableString(item.event_type);
      const windowDays = Number(item.window_days);
      if (eventType && Number.isFinite(windowDays) && windowDays > 0) {
        return `${eventType}:${windowDays}d`;
      }
      if (eventType) return eventType;
      return null;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "-";
}

function extractUtmString(finalUrl) {
  const normalized = readNullableString(finalUrl);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const utmEntries = Array.from(url.searchParams.entries()).filter(([key]) =>
      key.toLowerCase().startsWith("utm_"),
    );
    if (utmEntries.length === 0) return null;
    return utmEntries.map(([key, value]) => `${key}=${value}`).join("&");
  } catch {
    return null;
  }
}

function mergeTextValue(currentValue, incomingValue) {
  return readNullableString(currentValue) || readNullableString(incomingValue) || null;
}

function mergeListValue(currentValue, incomingValue) {
  const currentList = readStringList(currentValue);
  if (currentList.length > 0) return currentList;
  return readStringList(incomingValue);
}

function mergeAttributionSpec(currentValue, incomingValue) {
  if (Array.isArray(currentValue) && currentValue.length > 0) return currentValue;
  return Array.isArray(incomingValue) ? incomingValue : [];
}

function mergeNumberValue(currentValue, incomingValue) {
  const currentNumber = Number(currentValue);
  if (Number.isFinite(currentNumber) && currentNumber > 0) return currentNumber;
  const incomingNumber = Number(incomingValue);
  return Number.isFinite(incomingNumber) ? incomingNumber : 0;
}

function mergeNullableNumberValue(currentValue, incomingValue) {
  const currentNumber = readNullableNumber(currentValue);
  if (currentNumber !== null) return currentNumber;
  return readNullableNumber(incomingValue);
}

function hydrateMetaConfiguration(target, source) {
  if (!source) return target;

  target.ad_name = mergeTextValue(target.ad_name, source.ad_name);
  target.ad_status = mergeTextValue(target.ad_status, source.ad_status);
  target.ad_effective_status = mergeTextValue(target.ad_effective_status, source.ad_effective_status);
  target.primary_text = mergeTextValue(target.primary_text, source.primary_text);
  target.headline = mergeTextValue(target.headline, source.headline);
  target.description = mergeTextValue(target.description, source.description);
  target.cta_text = mergeTextValue(target.cta_text, source.cta_text);
  target.creative_id = mergeTextValue(target.creative_id, source.creative_id);
  target.creative_name = mergeTextValue(target.creative_name, source.creative_name);
  target.creative_asset_url = mergeTextValue(target.creative_asset_url, source.creative_asset_url);
  target.creative_thumbnail_url = mergeTextValue(
    target.creative_thumbnail_url,
    source.creative_thumbnail_url,
  );
  target.final_url = mergeTextValue(target.final_url, source.final_url);
  target.url_tags = mergeTextValue(target.url_tags, source.url_tags);
  target.post_id = mergeTextValue(target.post_id, source.post_id);
  target.post_permalink = mergeTextValue(target.post_permalink, source.post_permalink);
  target.adset_name = mergeTextValue(target.adset_name, source.adset_name);
  target.adset_status = mergeTextValue(target.adset_status, source.adset_status);
  target.adset_effective_status = mergeTextValue(
    target.adset_effective_status,
    source.adset_effective_status,
  );
  target.optimization_goal = mergeTextValue(target.optimization_goal, source.optimization_goal);
  target.optimization_event = mergeTextValue(target.optimization_event, source.optimization_event);
  target.billing_event = mergeTextValue(target.billing_event, source.billing_event);
  target.bid_strategy = mergeTextValue(target.bid_strategy, source.bid_strategy);
  target.bid_amount = mergeNumberValue(target.bid_amount, source.bid_amount);
  target.daily_budget = mergeNumberValue(target.daily_budget, source.daily_budget);
  target.lifetime_budget = mergeNumberValue(target.lifetime_budget, source.lifetime_budget);
  target.attribution_spec = mergeAttributionSpec(target.attribution_spec, source.attribution_spec);
  target.publisher_platforms = mergeListValue(target.publisher_platforms, source.publisher_platforms);
  target.facebook_positions = mergeListValue(target.facebook_positions, source.facebook_positions);
  target.instagram_positions = mergeListValue(target.instagram_positions, source.instagram_positions);
  target.device_platforms = mergeListValue(target.device_platforms, source.device_platforms);
  target.countries = mergeListValue(target.countries, source.countries);
  target.start_time = mergeTextValue(target.start_time, source.start_time);
  target.end_time = mergeTextValue(target.end_time, source.end_time);
  target.campaign_name = mergeTextValue(target.campaign_name, source.campaign_name);
  target.campaign_objective = mergeTextValue(target.campaign_objective, source.campaign_objective);
  target.campaign_status = mergeTextValue(target.campaign_status, source.campaign_status);
  target.campaign_effective_status = mergeTextValue(
    target.campaign_effective_status,
    source.campaign_effective_status,
  );
  target.campaign_buying_type = mergeTextValue(
    target.campaign_buying_type,
    source.campaign_buying_type,
  );
  target.reach = mergeNumberValue(target.reach, source.reach);
  target.outbound_clicks = mergeNumberValue(target.outbound_clicks, source.outbound_clicks);
  target.unique_outbound_clicks = mergeNumberValue(
    target.unique_outbound_clicks,
    source.unique_outbound_clicks,
  );
  target.frequency = mergeNumberValue(target.frequency, source.frequency);
  target.cpm = mergeNumberValue(target.cpm, source.cpm);
  target.result_count = mergeNullableNumberValue(target.result_count, source.result_count);
  target.cost_per_result = mergeNullableNumberValue(target.cost_per_result, source.cost_per_result);

  return target;
}

function formatMetaLinkedMetric(row, formatter) {
  if (!row?.hasMetaAttributionLink) return "N/A";
  return formatter();
}

function buildUniqueList(values) {
  return Array.from(new Set(values)).filter(Boolean).sort();
}

function toDateKey(value) {
  if (!value) return null;
  const dateValue = typeof value.toDate === "function" ? value.toDate() : value;
  if (!(dateValue instanceof Date)) return null;
  return dateValue.toISOString().slice(0, 10);
}

function normalizeKey(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

function hasFbclid(record) {
  const value = record?.fbclid;
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return Boolean(value);
}

function normalizeCountryCode(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function getAttribution(record) {
  const countryCode = normalizeCountryCode(record?.signup_country_code);
  if (hasFbclid(record)) {
    return {
      isPaid: true,
      type: "tracked_paid",
      countryCode,
    };
  }
  if (countryCode && INFERRED_PAID_COUNTRY_CODES.has(countryCode)) {
    return {
      isPaid: true,
      type: "inferred_paid",
      countryCode,
    };
  }
  return {
    isPaid: false,
    type: "non_paid",
    countryCode,
  };
}

function aliasKey(rawKey, aliases, fallback) {
  const key = normalizeKey(rawKey, fallback);
  return aliases[key] || key;
}

function isStepCompleted(record, field) {
  if (!record || !(field in record)) return null;
  const value = record[field];
  if (value === null || value === undefined) return null;
  return value === false;
}

function getOrCreate(map, key, factory) {
  if (!map.has(key)) {
    map.set(key, factory());
  }
  return map.get(key);
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMetaRow(row) {
  if (!row) return null;
  const adId = row.ad_id ? String(row.ad_id) : "unknown_ad";
  const adsetId = row.adset_id ? String(row.adset_id) : "unknown_adset";
  const campaignId = row.campaign_id ? String(row.campaign_id) : "unknown_campaign";

  const date = isDateString(row.date_start)
    ? row.date_start
    : isDateString(row.date)
      ? row.date
      : null;

  return {
    ad_id: adId,
    adset_id: adsetId,
    campaign_id: campaignId,
    ad_name: readNullableString(row.ad_name),
    ad_status: readNullableString(row.ad_status),
    ad_effective_status: readNullableString(row.ad_effective_status),
    primary_text: readNullableString(row.primary_text),
    headline: readNullableString(row.headline),
    description: readNullableString(row.description),
    cta_text: readNullableString(row.cta_text),
    creative_id: readNullableString(row.creative_id),
    creative_name: readNullableString(row.creative_name),
    creative_asset_url: readNullableString(row.creative_asset_url),
    creative_thumbnail_url: readNullableString(row.creative_thumbnail_url),
    final_url: readNullableString(row.final_url),
    url_tags: readNullableString(row.url_tags),
    post_id: readNullableString(row.post_id),
    post_permalink: readNullableString(row.post_permalink),
    adset_name: readNullableString(row.adset_name),
    adset_status: readNullableString(row.adset_status),
    adset_effective_status: readNullableString(row.adset_effective_status),
    optimization_goal: readNullableString(row.optimization_goal),
    optimization_event: resolveOptimizationEventLabel(row),
    billing_event: readNullableString(row.billing_event),
    bid_strategy: readNullableString(row.bid_strategy),
    bid_amount: toNumber(row.bid_amount),
    daily_budget: toNumber(row.daily_budget),
    lifetime_budget: toNumber(row.lifetime_budget),
    attribution_spec: Array.isArray(row.attribution_spec) ? row.attribution_spec : [],
    publisher_platforms: readStringList(row.publisher_platforms),
    facebook_positions: readStringList(row.facebook_positions),
    instagram_positions: readStringList(row.instagram_positions),
    device_platforms: readStringList(row.device_platforms),
    countries: readStringList(row.countries),
    start_time: readNullableString(row.start_time),
    end_time: readNullableString(row.end_time),
    campaign_name: readNullableString(row.campaign_name),
    campaign_objective: readNullableString(row.campaign_objective),
    campaign_status: readNullableString(row.campaign_status),
    campaign_effective_status: readNullableString(row.campaign_effective_status),
    campaign_buying_type: readNullableString(row.campaign_buying_type),
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    clicks: toNumber(row.clicks),
    outbound_clicks: toNumber(row.outbound_clicks),
    unique_outbound_clicks: toNumber(row.unique_outbound_clicks),
    frequency: Number.isFinite(Number(row.frequency)) ? Number(row.frequency) : null,
    cpm: Number.isFinite(Number(row.cpm)) ? Number(row.cpm) : null,
    result_count: readNullableNumber(row.result_count),
    cost_per_result: readNullableNumber(row.cost_per_result),
    date,
  };
}

function safeReadCache(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.cachedAt || !Array.isArray(parsed.rows)) return null;
    const age = Date.now() - Number(parsed.cachedAt);
    if (!Number.isFinite(age) || age > META_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeWriteCache(key, payload) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore localStorage errors for this internal tool.
  }
}

function createAdRow(id, adsetId = "unknown_adset", campaignId = "unknown_campaign") {
  return {
    id,
    ad_id: id,
    adset_id: adsetId,
    campaign_id: campaignId,
    ad_name: null,
    ad_status: null,
    ad_effective_status: null,
    primary_text: null,
    headline: null,
    description: null,
    cta_text: null,
    creative_id: null,
    creative_name: null,
    creative_asset_url: null,
    creative_thumbnail_url: null,
    final_url: null,
    url_tags: null,
    post_id: null,
    post_permalink: null,
    adset_name: null,
    adset_status: null,
    adset_effective_status: null,
    optimization_goal: null,
    optimization_event: null,
    billing_event: null,
    bid_strategy: null,
    bid_amount: 0,
    daily_budget: 0,
    lifetime_budget: 0,
    attribution_spec: [],
    publisher_platforms: [],
    facebook_positions: [],
    instagram_positions: [],
    device_platforms: [],
    countries: [],
    start_time: null,
    end_time: null,
    campaign_name: null,
    campaign_objective: null,
    campaign_status: null,
    campaign_effective_status: null,
    campaign_buying_type: null,
    hasMetaAttributionLink: false,
    signups: 0,
    tracked_signups: 0,
    inferred_signups: 0,
    invited: 0,
    blocked: 0,
    athleteShown: 0,
    paid: 0,
    revenue: 0,
    paidKnownRevenue: 0,
    powerlifters_selected: 0,
    bodybuilders_selected: 0,
    other_selected: 0,
    cookie_accepted_signups: 0,
    cookie_accepted_powerlifters_selected: 0,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    outbound_clicks: 0,
    unique_outbound_clicks: 0,
    frequency: null,
    cpm: null,
    result_count: null,
    cost_per_result: null,
  };
}

function createAdsetRow(id, campaignId = "unknown_campaign") {
  return {
    id,
    adset_id: id,
    campaign_id: campaignId,
    ad_count: 0,
    _adIds: new Set(),
    ad_name: null,
    ad_status: null,
    ad_effective_status: null,
    primary_text: null,
    headline: null,
    description: null,
    cta_text: null,
    creative_id: null,
    creative_name: null,
    creative_asset_url: null,
    creative_thumbnail_url: null,
    final_url: null,
    url_tags: null,
    post_id: null,
    post_permalink: null,
    adset_name: null,
    adset_status: null,
    adset_effective_status: null,
    optimization_goal: null,
    optimization_event: null,
    billing_event: null,
    bid_strategy: null,
    bid_amount: 0,
    daily_budget: 0,
    lifetime_budget: 0,
    attribution_spec: [],
    publisher_platforms: [],
    facebook_positions: [],
    instagram_positions: [],
    device_platforms: [],
    countries: [],
    start_time: null,
    end_time: null,
    campaign_name: null,
    campaign_objective: null,
    campaign_status: null,
    campaign_effective_status: null,
    campaign_buying_type: null,
    hasMetaAttributionLink: false,
    signups: 0,
    tracked_signups: 0,
    inferred_signups: 0,
    invited: 0,
    blocked: 0,
    athleteShown: 0,
    paid: 0,
    revenue: 0,
    paidKnownRevenue: 0,
    powerlifters_selected: 0,
    bodybuilders_selected: 0,
    other_selected: 0,
    cookie_accepted_signups: 0,
    cookie_accepted_powerlifters_selected: 0,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    outbound_clicks: 0,
    unique_outbound_clicks: 0,
    frequency: null,
    cpm: null,
    result_count: null,
    cost_per_result: null,
  };
}

function aggregateMetaRows(rows, filters) {
  const byAd = new Map();
  const byAdset = new Map();
  const byDate = new Map();

  let spend = 0;
  let impressions = 0;
  let reach = 0;
  let clicks = 0;

  for (const row of rows) {
    if (filters.ad !== "all" && row.ad_id !== filters.ad) continue;
    if (filters.adset !== "all" && row.adset_id !== filters.adset) continue;
    if (filters.campaign !== "all" && row.campaign_id !== filters.campaign) continue;

    spend += row.spend;
    impressions += row.impressions;
    reach += row.reach || 0;
    clicks += row.clicks;

    const adRow = getOrCreate(byAd, row.ad_id, () => ({
      ad_id: row.ad_id,
      adset_id: row.adset_id,
      campaign_id: row.campaign_id,
      ...createAdRow(row.ad_id, row.adset_id, row.campaign_id),
      spend: 0,
      impressions: 0,
      clicks: 0,
    }));
    hydrateMetaConfiguration(adRow, row);
    adRow.spend += row.spend;
    adRow.impressions += row.impressions;
    adRow.reach += row.reach || 0;
    adRow.clicks += row.clicks;
    adRow.outbound_clicks += row.outbound_clicks || 0;
    adRow.unique_outbound_clicks += row.unique_outbound_clicks || 0;
    if (row.result_count !== null && row.result_count !== undefined) {
      adRow.result_count = (adRow.result_count ?? 0) + row.result_count;
    }
    if (adRow.impressions > 0) {
      adRow.cpm = (adRow.spend * 1000) / adRow.impressions;
    }
    if (adRow.reach > 0) {
      adRow.frequency = adRow.impressions / adRow.reach;
    }
    if (adRow.result_count !== null && adRow.result_count > 0) {
      adRow.cost_per_result = adRow.spend / adRow.result_count;
    }

    const adsetRow = getOrCreate(byAdset, row.adset_id, () => ({
      ...createAdsetRow(row.adset_id, row.campaign_id),
    }));
    hydrateMetaConfiguration(adsetRow, row);
    adsetRow._adIds.add(row.ad_id);
    adsetRow.ad_count = adsetRow._adIds.size;
    adsetRow.spend += row.spend;
    adsetRow.impressions += row.impressions;
    adsetRow.reach += row.reach || 0;
    adsetRow.clicks += row.clicks;
    adsetRow.outbound_clicks += row.outbound_clicks || 0;
    adsetRow.unique_outbound_clicks += row.unique_outbound_clicks || 0;
    if (row.result_count !== null && row.result_count !== undefined) {
      adsetRow.result_count = (adsetRow.result_count ?? 0) + row.result_count;
    }
    if (adsetRow.impressions > 0) {
      adsetRow.cpm = (adsetRow.spend * 1000) / adsetRow.impressions;
    }
    if (adsetRow.reach > 0) {
      adsetRow.frequency = adsetRow.impressions / adsetRow.reach;
    }
    if (adsetRow.result_count !== null && adsetRow.result_count > 0) {
      adsetRow.cost_per_result = adsetRow.spend / adsetRow.result_count;
    }
    adsetRow.hasMetaAttributionLink = true;

    if (row.date) {
      const dayRow = getOrCreate(byDate, row.date, () => ({
        spend: 0,
        impressions: 0,
        clicks: 0,
      }));
      dayRow.spend += row.spend;
      dayRow.impressions += row.impressions;
      dayRow.clicks += row.clicks;
    }
  }

  return {
    totals: {spend, impressions, reach, clicks},
    byAd,
    byAdset,
    byDate,
  };
}

function computeAdMetrics(row) {
  const impressionsPerEuro =
    row.hasMetaAttributionLink && row.spend > 0 ? row.impressions / row.spend : null;
  const clicksPerEuro = row.hasMetaAttributionLink && row.spend > 0 ? row.clicks / row.spend : null;
  const ctr = row.hasMetaAttributionLink && row.impressions > 0 ? row.clicks / row.impressions : null;
  const cpc = row.hasMetaAttributionLink && row.clicks > 0 ? row.spend / row.clicks : null;
  const cpm =
    row.hasMetaAttributionLink
      ? row.cpm ?? (row.impressions > 0 ? (row.spend * 1000) / row.impressions : null)
      : null;
  const clickToSignupRate =
    row.hasMetaAttributionLink && row.clicks > 0 ? row.signups / row.clicks : null;
  const paidRate = row.signups > 0 ? row.paid / row.signups : null;
  const inviteRate = row.signups > 0 ? row.invited / row.signups : null;
  const blockRate = row.signups > 0 ? row.blocked / row.signups : null;
  const athleteRate = row.signups > 0 ? row.athleteShown / row.signups : null;
  const costPerSignup =
    row.hasMetaAttributionLink && row.signups > 0 ? row.spend / row.signups : null;
  const cac = row.hasMetaAttributionLink && row.paid > 0 ? row.spend / row.paid : null;
  const roas = row.hasMetaAttributionLink && row.spend > 0 ? row.revenue / row.spend : null;
  const powerliftersRate = row.signups > 0 ? row.powerlifters_selected / row.signups : null;
  const bodybuildersRate = row.signups > 0 ? row.bodybuilders_selected / row.signups : null;
  const otherRate = row.signups > 0 ? row.other_selected / row.signups : null;
  const result_count = resolveInternalResultCount({
    optimizationEvent: row.optimization_event,
    cookieAcceptedSignups: row.cookie_accepted_signups,
    cookieAcceptedPowerliftersSelected: row.cookie_accepted_powerlifters_selected,
  });
  const cost_per_result = resolveInternalCostPerResult({
    hasMetaAttributionLink: row.hasMetaAttributionLink,
    spend: row.spend,
    resultCount: result_count,
  });

  return {
    ...row,
    impressionsPerEuro,
    clicksPerEuro,
    ctr,
    cpc,
    cpm,
    clickToSignupRate,
    paidRate,
    inviteRate,
    blockRate,
    athleteRate,
    powerliftersRate,
    bodybuildersRate,
    otherRate,
    result_count,
    cost_per_result,
    costPerSignup,
    cac,
    roas,
  };
}

function computeAdsetMetrics(row) {
  const ctr = row.hasMetaAttributionLink && row.impressions > 0 ? row.clicks / row.impressions : null;
  const cpc = row.hasMetaAttributionLink && row.clicks > 0 ? row.spend / row.clicks : null;
  const cpm =
    row.hasMetaAttributionLink
      ? row.cpm ?? (row.impressions > 0 ? (row.spend * 1000) / row.impressions : null)
      : null;
  const clickToSignupRate =
    row.hasMetaAttributionLink && row.clicks > 0 ? row.signups / row.clicks : null;
  const signupToPaidRate = row.signups > 0 ? row.paid / row.signups : null;
  const costPerSignup =
    row.hasMetaAttributionLink && row.signups > 0 ? row.spend / row.signups : null;
  const cac = row.hasMetaAttributionLink && row.paid > 0 ? row.spend / row.paid : null;
  const roas = row.hasMetaAttributionLink && row.spend > 0 ? row.revenue / row.spend : null;
  const powerliftersRate = row.signups > 0 ? row.powerlifters_selected / row.signups : null;
  const bodybuildersRate = row.signups > 0 ? row.bodybuilders_selected / row.signups : null;
  const otherRate = row.signups > 0 ? row.other_selected / row.signups : null;
  const result_count = resolveInternalResultCount({
    optimizationEvent: row.optimization_event,
    cookieAcceptedSignups: row.cookie_accepted_signups,
    cookieAcceptedPowerliftersSelected: row.cookie_accepted_powerlifters_selected,
  });
  const cost_per_result = resolveInternalCostPerResult({
    hasMetaAttributionLink: row.hasMetaAttributionLink,
    spend: row.spend,
    resultCount: result_count,
  });

  return {
    ...row,
    ad_count:
      row._adIds instanceof Set ? row._adIds.size : Number.isFinite(Number(row.ad_count)) ? row.ad_count : 0,
    ctr,
    cpc,
    cpm,
    clickToSignupRate,
    signupToPaidRate,
    powerliftersRate,
    bodybuildersRate,
    otherRate,
    result_count,
    cost_per_result,
    costPerSignup,
    cac,
    roas,
  };
}

const APP_ROUTES = {
  analytics: "/",
  feedback: "/feedback",
  tasks: "/tasks",
};

const DEMO_USER = {
  email: "demo@efort.center",
  displayName: "Ben (demo)",
};

function normalizeRoute(pathname) {
  if (pathname === APP_ROUTES.tasks) return APP_ROUTES.tasks;
  if (pathname === APP_ROUTES.feedback) return APP_ROUTES.feedback;
  return APP_ROUTES.analytics;
}

function AnalyticsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="site-nav-icon-svg">
      <path d="M4 15.5h2.2V8H4v7.5Zm4.9 0h2.2V4.5H8.9v11Zm4.9 0H16V10h-2.2v5.5Z" fill="currentColor" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="site-nav-icon-svg">
      <path d="M4.25 5.25A1.25 1.25 0 0 1 5.5 4h1a1.25 1.25 0 1 1 0 2.5h-1a1.25 1.25 0 0 1-1.25-1.25Zm0 4.75A1.25 1.25 0 0 1 5.5 8.75h1a1.25 1.25 0 1 1 0 2.5h-1A1.25 1.25 0 0 1 4.25 10Zm0 4.75A1.25 1.25 0 0 1 5.5 13.5h1a1.25 1.25 0 1 1 0 2.5h-1a1.25 1.25 0 0 1-1.25-1.25ZM9 5.25c0-.41.34-.75.75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 9 5.25Zm0 4.75c0-.41.34-.75.75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 9 10Zm0 4.75c0-.41.34-.75.75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Z" fill="currentColor" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="site-nav-icon-svg">
      <path d="M5 4.75A2.25 2.25 0 0 0 2.75 7v5A2.25 2.25 0 0 0 5 14.25h1.78l2.6 2.18a.75.75 0 0 0 1.23-.58v-1.6H15A2.25 2.25 0 0 0 17.25 12V7A2.25 2.25 0 0 0 15 4.75H5Zm1.5 3a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 6.5 7.75Zm0 2.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Z" fill="currentColor" />
    </svg>
  );
}

function MenuToggleIcon({open}) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="site-nav-icon-svg">
      {open ? (
        <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" fill="currentColor" />
      ) : (
        <path d="M3.75 5.5A.75.75 0 0 1 4.5 4.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75Zm0 4.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75Zm0 4.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75Z" fill="currentColor" />
      )}
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="account-icon-svg">
      <path d="M10 10a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 10Zm0 1.6c-3.1 0-5.6 1.7-5.6 3.8v.6h11.2v-.6c0-2.1-2.5-3.8-5.6-3.8Z" fill="currentColor" />
    </svg>
  );
}

function SiteMenu({currentRoute, onNavigate, sessionUser, onSignOut, showSignOut}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const items = [
    {path: APP_ROUTES.analytics, label: "Analytics", icon: <AnalyticsIcon />},
    {path: APP_ROUTES.feedback, label: "Feedback", icon: <FeedbackIcon />},
    {path: APP_ROUTES.tasks, label: "Tasks", icon: <TasksIcon />},
  ];

  useEffect(() => {
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  }, [currentRoute]);

  return (
    <aside className={mobileMenuOpen ? "site-menu mobile-open" : "site-menu"}>
      <div className="site-menu-topbar">
        <div className="site-menu-header">
          <div className="eyebrow">Workspace</div>
          <h2>EFORT CENTER</h2>
        </div>
        <button
          type="button"
          className={mobileMenuOpen ? "site-menu-toggle active" : "site-menu-toggle"}
          aria-expanded={mobileMenuOpen}
          aria-controls="site-menu-content"
          aria-label={mobileMenuOpen ? "Hide workspace menu" : "Show workspace menu"}
          onClick={() => setMobileMenuOpen((value) => !value)}
        >
          <span className="site-nav-icon"><MenuToggleIcon open={mobileMenuOpen} /></span>
        </button>
      </div>

      <button
        type="button"
        className="site-menu-overlay"
        aria-label="Close workspace menu"
        onClick={() => setMobileMenuOpen(false)}
      />

      <div className="site-menu-content" id="site-menu-content">
        <div className="site-menu-nav-group">
          <nav className="site-nav" aria-label="Sections">
            {items.map((item) => {
              const active = currentRoute === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  className={active ? "site-nav-link active" : "site-nav-link"}
                  onClick={() => {
                    onNavigate(item.path);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="site-nav-icon">{item.icon}</span>
                  <span className="site-nav-title">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {sessionUser ? (
          <div className="site-menu-footer">
            <button
              type="button"
              className={accountMenuOpen ? "account-button active" : "account-button"}
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              <span className="account-icon"><AccountIcon /></span>
              <span className="account-copy">
                <span className="account-label">Account</span>
                <span className="account-email">{sessionUser.email}</span>
              </span>
            </button>

            {accountMenuOpen ? (
              <div className="account-menu">
                {showSignOut ? (
                  <button type="button" className="account-menu-item" onClick={onSignOut}>
                    Sign out
                  </button>
                ) : (
                  <div className="account-menu-note">Demo session</div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function App() {
  const today = new Date();
  const defaultEnd = formatDateInput(today);
  const defaultStart = `${today.getFullYear()}-02-03`;

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [metaError, setMetaError] = useState("");

  const [records, setRecords] = useState([]);
  const [metaRows, setMetaRows] = useState([]);
  const [metaCurrency, setMetaCurrency] = useState("EUR");
  const [metaTimezone, setMetaTimezone] = useState("Europe/Berlin");
  const [assetExporting, setAssetExporting] = useState(false);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [audienceScope, setAudienceScope] = useState("ads_only");
  const [adsetFilter, setAdsetFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [adFilter, setAdFilter] = useState("all");
  const [currentRoute, setCurrentRoute] = useState(() => normalizeRoute(window.location.pathname));

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      setUser(null);
      setIsAdmin(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser || null);
      setAuthReady(true);
      if (!currentUser) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(hasDashboardAccess(currentUser));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(normalizeRoute(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateTo = (path) => {
    if (normalizeRoute(window.location.pathname) === path) return;
    window.history.pushState({}, "", path);
    setCurrentRoute(path);
  };

  const fetchMetaInsights = async ({since, until, forceRefresh = false}) => {
    if (!functions) {
      throw new Error("Firebase Functions is not initialized.");
    }

    const cacheKey = `meta:v2:${since}:${until}`;
    if (META_CACHE_ENABLED && !forceRefresh) {
      const cached = safeReadCache(cacheKey);
      if (cached) {
        return {
          rows: cached.rows.map((row) => parseMetaRow(row)).filter(Boolean),
          currency: cached.currency || "EUR",
          timezone: cached.timezone || "Europe/Berlin",
        };
      }
    }

    const callable = httpsCallable(functions, META_CALLABLE_NAME);
    const response = await callable({
      since,
      until,
      aggregate: true,
      daily: true,
      level: "ad",
    });

    const payload = response?.data || {};
    let rows = [];

    if (Array.isArray(payload.rows)) {
      rows = payload.rows.map((item) => parseMetaRow(item)).filter(Boolean);
    }

    if (
      rows.length === 0 &&
      payload.dailyByKey &&
      typeof payload.dailyByKey === "object"
    ) {
      const fromDaily = [];
      const totalsByKey =
        payload.totalsByKey && typeof payload.totalsByKey === "object"
          ? payload.totalsByKey
          : {};

      for (const [key, byDate] of Object.entries(payload.dailyByKey)) {
        if (!byDate || typeof byDate !== "object") continue;
        const ids = totalsByKey[key] && typeof totalsByKey[key] === "object"
          ? totalsByKey[key]
          : {};

        for (const [date, metrics] of Object.entries(byDate)) {
          if (!metrics || typeof metrics !== "object") continue;
          const row = parseMetaRow({
            ad_id: ids.ad_id || key,
            adset_id: ids.adset_id,
            campaign_id: ids.campaign_id,
            ad_name: ids.ad_name,
            ad_status: ids.ad_status,
            ad_effective_status: ids.ad_effective_status,
            primary_text: ids.primary_text,
            headline: ids.headline,
            description: ids.description,
            cta_text: ids.cta_text,
            creative_id: ids.creative_id,
            creative_name: ids.creative_name,
            creative_asset_url: ids.creative_asset_url,
            creative_thumbnail_url: ids.creative_thumbnail_url,
            final_url: ids.final_url,
            url_tags: ids.url_tags,
            post_id: ids.post_id,
            post_permalink: ids.post_permalink,
            adset_name: ids.adset_name,
            adset_status: ids.adset_status,
            adset_effective_status: ids.adset_effective_status,
            optimization_goal: ids.optimization_goal,
            optimization_event: ids.optimization_event,
            billing_event: ids.billing_event,
            bid_strategy: ids.bid_strategy,
            bid_amount: ids.bid_amount,
            daily_budget: ids.daily_budget,
            lifetime_budget: ids.lifetime_budget,
            attribution_spec: ids.attribution_spec,
            publisher_platforms: ids.publisher_platforms,
            facebook_positions: ids.facebook_positions,
            instagram_positions: ids.instagram_positions,
            device_platforms: ids.device_platforms,
            countries: ids.countries,
            start_time: ids.start_time,
            end_time: ids.end_time,
            campaign_name: ids.campaign_name,
            campaign_objective: ids.campaign_objective,
            campaign_status: ids.campaign_status,
            campaign_effective_status: ids.campaign_effective_status,
            campaign_buying_type: ids.campaign_buying_type,
            spend: metrics.spend,
            impressions: metrics.impressions,
            reach: metrics.reach,
            clicks: metrics.clicks,
            outbound_clicks: metrics.outbound_clicks,
            unique_outbound_clicks: metrics.unique_outbound_clicks,
            frequency: metrics.frequency,
            cpm: metrics.cpm,
            result_count: metrics.result_count,
            cost_per_result: metrics.cost_per_result,
            date_start: date,
            date_stop: date,
          });
          if (row) fromDaily.push(row);
        }
      }
      rows = fromDaily;
    }

    if (rows.length === 0 && payload.totalsByKey && typeof payload.totalsByKey === "object") {
      rows = Object.entries(payload.totalsByKey)
        .map(([key, value]) => {
          const normalized = value && typeof value === "object" ? value : {};
          return parseMetaRow({
            ad_id: normalized.ad_id || key,
            adset_id: normalized.adset_id,
            campaign_id: normalized.campaign_id,
            ad_name: normalized.ad_name,
            ad_status: normalized.ad_status,
            ad_effective_status: normalized.ad_effective_status,
            primary_text: normalized.primary_text,
            headline: normalized.headline,
            description: normalized.description,
            cta_text: normalized.cta_text,
            creative_id: normalized.creative_id,
            creative_name: normalized.creative_name,
            creative_asset_url: normalized.creative_asset_url,
            creative_thumbnail_url: normalized.creative_thumbnail_url,
            final_url: normalized.final_url,
            url_tags: normalized.url_tags,
            post_id: normalized.post_id,
            post_permalink: normalized.post_permalink,
            adset_name: normalized.adset_name,
            adset_status: normalized.adset_status,
            adset_effective_status: normalized.adset_effective_status,
            optimization_goal: normalized.optimization_goal,
            optimization_event: normalized.optimization_event,
            billing_event: normalized.billing_event,
            bid_strategy: normalized.bid_strategy,
            bid_amount: normalized.bid_amount,
            daily_budget: normalized.daily_budget,
            lifetime_budget: normalized.lifetime_budget,
            attribution_spec: normalized.attribution_spec,
            publisher_platforms: normalized.publisher_platforms,
            facebook_positions: normalized.facebook_positions,
            instagram_positions: normalized.instagram_positions,
            device_platforms: normalized.device_platforms,
            countries: normalized.countries,
            start_time: normalized.start_time,
            end_time: normalized.end_time,
            campaign_name: normalized.campaign_name,
            campaign_objective: normalized.campaign_objective,
            campaign_status: normalized.campaign_status,
            campaign_effective_status: normalized.campaign_effective_status,
            campaign_buying_type: normalized.campaign_buying_type,
            spend: normalized.spend,
            impressions: normalized.impressions,
            reach: normalized.reach,
            clicks: normalized.clicks,
            outbound_clicks: normalized.outbound_clicks,
            unique_outbound_clicks: normalized.unique_outbound_clicks,
            frequency: normalized.frequency,
            cpm: normalized.cpm,
            result_count: normalized.result_count,
            cost_per_result: normalized.cost_per_result,
          });
        })
        .filter(Boolean);
    }

    const normalized = {
      rows,
      currency: payload.currency || "EUR",
      timezone: payload.timezone || "Europe/Berlin",
    };

    if (META_CACHE_ENABLED) {
      safeWriteCache(cacheKey, {
        cachedAt: Date.now(),
        rows,
        currency: normalized.currency,
        timezone: normalized.timezone,
      });
    }

    return normalized;
  };

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    setMetaError("");

    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const coachesRef = collection(db, "coaches_public");
      const coachesQuery = query(
        coachesRef,
        where("trial_period_start_date", ">=", start),
        where("trial_period_start_date", "<=", end),
      );

      const [coachesSnapshot, metaResult] = await Promise.all([
        getDocs(coachesQuery),
        fetchMetaInsights({since: startDate, until: endDate, forceRefresh}).catch((err) => {
          setMetaError(err?.message || "Failed to load Meta insights");
          return {rows: [], currency: "EUR", timezone: "Europe/Berlin"};
        }),
      ]);

      setRecords(coachesSnapshot.docs.map((docSnap) => docSnap.data()));
      setMetaRows(metaResult.rows || []);
      setMetaCurrency(metaResult.currency || "EUR");
      setMetaTimezone(metaResult.timezone || "Europe/Berlin");
    } catch (err) {
      setError(err?.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin && currentRoute === APP_ROUTES.analytics) {
      loadData(false);
    }
  }, [currentRoute, isAdmin, startDate, endDate]);

  const normalizedMetaRows = useMemo(() => {
    return metaRows.map((row) => ({
      ...row,
      ad_id: aliasKey(row.ad_id, adKeyAliases, "unknown_ad"),
      adset_id: aliasKey(row.adset_id, adsetKeyAliases, "unknown_adset"),
      campaign_id: aliasKey(row.campaign_id, campaignKeyAliases, "unknown_campaign"),
    }));
  }, [metaRows]);

  const scopedRecords = useMemo(() => {
    const enriched = records.map((record) => {
      const attribution = getAttribution(record);
      const inferredFallback = attribution.type === "inferred_paid" ? INFERRED_PAID_UNKNOWN : null;
      const adId = aliasKey(record.utm_content, adKeyAliases, inferredFallback || "unknown_ad");
      const adsetId = aliasKey(record.utm_adset, adsetKeyAliases, inferredFallback || "unknown_adset");
      const campaignId = aliasKey(
        record.utm_campaign,
        campaignKeyAliases,
        inferredFallback || "unknown_campaign",
      );

      return {
        ...record,
        _attribution: attribution,
        _adId: adId,
        _adsetId: adsetId,
        _campaignId: campaignId,
      };
    });
    if (audienceScope === "all") return enriched;
    return enriched.filter((record) => record._attribution.isPaid);
  }, [records, audienceScope]);

  const adsetOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => item._adsetId),
      ...normalizedMetaRows.map((item) => item.adset_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const campaignOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => item._campaignId),
      ...normalizedMetaRows.map((item) => item.campaign_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const adOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => item._adId),
      ...normalizedMetaRows.map((item) => item.ad_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const filteredRecords = useMemo(() => {
    return scopedRecords.filter((record) => {
      if (adsetFilter !== "all" && record._adsetId !== adsetFilter) return false;
      if (campaignFilter !== "all" && record._campaignId !== campaignFilter) return false;
      if (adFilter !== "all" && record._adId !== adFilter) return false;
      return true;
    });
  }, [scopedRecords, adsetFilter, campaignFilter, adFilter]);

  const metaAggregate = useMemo(() => {
    return aggregateMetaRows(normalizedMetaRows, {
      ad: adFilter,
      adset: adsetFilter,
      campaign: campaignFilter,
    });
  }, [normalizedMetaRows, adFilter, adsetFilter, campaignFilter]);

  const derived = useMemo(() => {
    const adMap = new Map();
    const adsetMap = new Map();
    const coachesByDate = new Map();
    const athleteTypeDailyDistribution = computeAthleteTypeDailyDistribution(
      filteredRecords,
      (record) => record?.trial_period_start_date,
    );
    const athleteTypeDailyCoachMix = computeAthleteTypeDailyCoachMix(
      filteredRecords,
      (record) => record?.trial_period_start_date,
    );

    const funnelTotals = {
      signups: 0,
      invited: 0,
      blocked: 0,
      athleteShown: 0,
      paid: 0,
      revenue: 0,
      paidKnownRevenue: 0,
    };
    const attributionTotals = {
      trackedSignups: 0,
      inferredSignups: 0,
      nonPaidSignups: 0,
      trackedPaid: 0,
      inferredPaid: 0,
      nonPaidPaid: 0,
    };
    const funnelAttribution = createEmptyFunnelAttribution();

    for (const record of filteredRecords) {
      const attributionType = record._attribution?.type || "non_paid";
      const adId = record._adId;
      const adsetId = record._adsetId;
      const campaignId = record._campaignId;

      const row = getOrCreate(adMap, adId, () => createAdRow(adId, adsetId, campaignId));
      row.adset_id = row.adset_id || adsetId;
      row.campaign_id = row.campaign_id || campaignId;

      const adsetRow = getOrCreate(adsetMap, adsetId, () => createAdsetRow(adsetId, campaignId));
      adsetRow.campaign_id = adsetRow.campaign_id || campaignId;
      adsetRow._adIds.add(adId);
      adsetRow.ad_count = adsetRow._adIds.size;

      row.signups += 1;
      adsetRow.signups += 1;
      funnelTotals.signups += 1;
      if (attributionType === "tracked_paid") {
        row.tracked_signups += 1;
        adsetRow.tracked_signups += 1;
        attributionTotals.trackedSignups += 1;
      } else if (attributionType === "inferred_paid") {
        row.inferred_signups += 1;
        adsetRow.inferred_signups += 1;
        attributionTotals.inferredSignups += 1;
      } else {
        attributionTotals.nonPaidSignups += 1;
      }

      const inviteCompleted = isStepCompleted(record, "onboarding_show_invite_client") === true;
      const blockCompleted = isStepCompleted(record, "onboarding_show_block") === true;
      const athleteShown = isStepCompleted(record, "onboarding_show_athlete_app") === true;
      const paid = record.has_paid === true;
      const cookiesAccepted = record.cookies_accepted === true;
      const athleteTypes = normalizeAthleteTypes(record.onboarding_athletes_types);

      incrementFunnelAttribution(funnelAttribution, {
        attributionType,
        invited: inviteCompleted,
        blocked: blockCompleted,
        athleteShown,
        paid,
      });

      if (inviteCompleted) {
        row.invited += 1;
        adsetRow.invited += 1;
        funnelTotals.invited += 1;
      }
      if (blockCompleted) {
        row.blocked += 1;
        adsetRow.blocked += 1;
        funnelTotals.blocked += 1;
      }
      if (athleteShown) {
        row.athleteShown += 1;
        adsetRow.athleteShown += 1;
        funnelTotals.athleteShown += 1;
      }
      if (paid) {
        row.paid += 1;
        adsetRow.paid += 1;
        funnelTotals.paid += 1;
        if (attributionType === "tracked_paid") {
          attributionTotals.trackedPaid += 1;
        } else if (attributionType === "inferred_paid") {
          attributionTotals.inferredPaid += 1;
        } else {
          attributionTotals.nonPaidPaid += 1;
        }
      }

      const priceId = record.subscription_price_id;
      const priceValue =
        priceId && Object.prototype.hasOwnProperty.call(priceCatalog, priceId)
          ? priceCatalog[priceId]
          : null;

      if (paid && priceValue !== null) {
        row.revenue += priceValue;
        row.paidKnownRevenue += 1;
        adsetRow.revenue += priceValue;
        adsetRow.paidKnownRevenue += 1;
        funnelTotals.revenue += priceValue;
        funnelTotals.paidKnownRevenue += 1;
      }

      if (athleteTypes.includes("powerlifters")) {
        row.powerlifters_selected += 1;
        adsetRow.powerlifters_selected += 1;
      }
      if (athleteTypes.includes("bodybuilders")) {
        row.bodybuilders_selected += 1;
        adsetRow.bodybuilders_selected += 1;
      }
      if (athleteTypes.includes("other")) {
        row.other_selected += 1;
        adsetRow.other_selected += 1;
      }
      if (cookiesAccepted) {
        row.cookie_accepted_signups += 1;
        adsetRow.cookie_accepted_signups += 1;
        if (athleteTypes.includes("powerlifters")) {
          row.cookie_accepted_powerlifters_selected += 1;
          adsetRow.cookie_accepted_powerlifters_selected += 1;
        }
      }

      const dateKey = toDateKey(record.trial_period_start_date);
      if (dateKey) {
        const dateRow = getOrCreate(coachesByDate, dateKey, () => ({
          signups: 0,
          paid: 0,
          tracked_signups: 0,
          inferred_signups: 0,
          non_paid_signups: 0,
        }));
        dateRow.signups += 1;
        if (attributionType === "tracked_paid") {
          dateRow.tracked_signups += 1;
        } else if (attributionType === "inferred_paid") {
          dateRow.inferred_signups += 1;
        } else {
          dateRow.non_paid_signups += 1;
        }
        if (paid) {
          dateRow.paid += 1;
        }
      }
    }

    for (const [adId, meta] of metaAggregate.byAd.entries()) {
      const row = getOrCreate(
        adMap,
        adId,
        () => createAdRow(adId, meta.adset_id || "unknown_adset", meta.campaign_id || "unknown_campaign"),
      );
      if (!row.adset_id || row.adset_id.startsWith("unknown")) {
        row.adset_id = meta.adset_id || row.adset_id;
      }
      if (!row.campaign_id || row.campaign_id.startsWith("unknown")) {
        row.campaign_id = meta.campaign_id || row.campaign_id;
      }
      hydrateMetaConfiguration(row, meta);
      row.spend = meta.spend;
      row.impressions = meta.impressions;
      row.reach = meta.reach || 0;
      row.clicks = meta.clicks;
      row.outbound_clicks = meta.outbound_clicks || 0;
      row.unique_outbound_clicks = meta.unique_outbound_clicks || 0;
      row.frequency = meta.frequency ?? row.frequency;
      row.cpm = meta.cpm ?? row.cpm;
      row.hasMetaAttributionLink = true;
    }

    for (const [adsetId, meta] of metaAggregate.byAdset.entries()) {
      const row = getOrCreate(
        adsetMap,
        adsetId,
        () => createAdsetRow(adsetId, meta.campaign_id || "unknown_campaign"),
      );
      if (!row.campaign_id || row.campaign_id.startsWith("unknown")) {
        row.campaign_id = meta.campaign_id || row.campaign_id;
      }
      hydrateMetaConfiguration(row, meta);
      row.ad_count =
        row._adIds instanceof Set && row._adIds.size > 0
          ? row._adIds.size
          : meta._adIds instanceof Set && meta._adIds.size > 0
            ? meta._adIds.size
            : meta.ad_count || row.ad_count;
      row.spend = meta.spend;
      row.impressions = meta.impressions;
      row.reach = meta.reach || 0;
      row.clicks = meta.clicks;
      row.outbound_clicks = meta.outbound_clicks || 0;
      row.unique_outbound_clicks = meta.unique_outbound_clicks || 0;
      row.frequency = meta.frequency ?? row.frequency;
      row.cpm = meta.cpm ?? row.cpm;
      row.hasMetaAttributionLink = true;
    }

    const adRows = Array.from(adMap.values()).map((row) => computeAdMetrics(row));
    const adRowsByAdset = new Map();
    for (const adRow of adRows) {
      const rowsForAdset = adRowsByAdset.get(adRow.adset_id) || [];
      rowsForAdset.push(adRow);
      adRowsByAdset.set(adRow.adset_id, rowsForAdset);
    }
    const adsetRows = Array.from(adsetMap.values()).map((row) => (
      rollupAdsetResultMetrics(
        computeAdsetMetrics(row),
        adRowsByAdset.get(row.adset_id) || [],
      )
    ));

    const topBySpend = adRows
      .filter((row) => row.spend > 0)
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);

    const topBySignups = adRows
      .filter((row) => row.signups > 0)
      .slice()
      .sort((a, b) => b.signups - a.signups)
      .slice(0, 10);

    const metaDates = Array.from(metaAggregate.byDate.keys()).sort();
    const metaSeries = {
      labels: metaDates,
      spend: metaDates.map((date) => metaAggregate.byDate.get(date)?.spend || 0),
      clicks: metaDates.map((date) => metaAggregate.byDate.get(date)?.clicks || 0),
      impressions: metaDates.map((date) => metaAggregate.byDate.get(date)?.impressions || 0),
    };

    const coachDates = Array.from(coachesByDate.keys()).sort();
    const coachSeries = {
      labels: coachDates,
      signups: coachDates.map((date) => coachesByDate.get(date)?.signups || 0),
      paid: coachDates.map((date) => coachesByDate.get(date)?.paid || 0),
      trackedSignups: coachDates.map((date) => coachesByDate.get(date)?.tracked_signups || 0),
      inferredSignups: coachDates.map((date) => coachesByDate.get(date)?.inferred_signups || 0),
      nonPaidSignups: coachDates.map((date) => coachesByDate.get(date)?.non_paid_signups || 0),
    };

    return {
      adRows,
      adsetRows,
      topBySpend,
      topBySignups,
      metaSeries,
      coachSeries,
      funnelTotals,
      funnelAttribution,
      attributionTotals,
      metaTotals: metaAggregate.totals,
      athleteTypeDailyDistribution,
      athleteTypeDailyCoachMix,
    };
  }, [filteredRecords, metaAggregate]);

  const tableRows = useMemo(() => {
    return derived.adRows
      .slice()
      .sort((a, b) => {
        if (b.signups !== a.signups) return b.signups - a.signups;
        return (b.spend || 0) - (a.spend || 0);
      });
  }, [derived.adRows]);
  const adsetTableRows = useMemo(() => {
    return derived.adsetRows
      .filter((row) => row.adset_id !== INFERRED_PAID_UNKNOWN && row.adset_id !== UNKNOWN_ADSET)
      .slice()
      .sort((a, b) => {
        if (b.signups !== a.signups) return b.signups - a.signups;
        return (b.spend || 0) - (a.spend || 0);
      });
  }, [derived.adsetRows]);
  const topBySignupsWithMeta = useMemo(() => {
    return derived.topBySignups.filter((row) => row.hasMetaAttributionLink);
  }, [derived.topBySignups]);
  const renderCreativeCell = (row) => formatMetaLinkedMetric(row, () => (
    row.creative_thumbnail_url || row.creative_name || row.creative_id
      ? (
        <div className="creative-cell">
          {row.creative_thumbnail_url && (
            <img
              className="creative-thumb"
              src={row.creative_thumbnail_url}
              alt={row.creative_name || row.creative_id || "Creative thumbnail"}
              loading="lazy"
            />
          )}
          <span>{row.creative_name || row.creative_id || "-"}</span>
        </div>
      )
      : "-"
  ));

  const adTableColumns = [
    {
      label: "Ad ID",
      cell: (row) => (
        row.ad_id === INFERRED_PAID_UNKNOWN
          ? `${INFERRED_PAID_UNKNOWN} (country-inferred)`
          : row.ad_id
      ),
      csvValue: (row) => (
        row.ad_id === INFERRED_PAID_UNKNOWN
          ? `${INFERRED_PAID_UNKNOWN} (country-inferred)`
          : row.ad_id
      ),
    },
    {label: "Ad Name", cell: (row) => formatMetaLinkedMetric(row, () => row.ad_name || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.ad_name || "-")},
    {label: "Ad Effective Status", cell: (row) => formatMetaLinkedMetric(row, () => row.ad_effective_status || row.ad_status || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.ad_effective_status || row.ad_status || "-")},
    {label: "Primary Text", cell: (row) => formatMetaLinkedMetric(row, () => row.primary_text || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.primary_text || "-")},
    {label: "Headline", cell: (row) => formatMetaLinkedMetric(row, () => row.headline || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.headline || "-")},
    {label: "Description", cell: (row) => formatMetaLinkedMetric(row, () => row.description || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.description || "-")},
    {label: "CTA Text", cell: (row) => formatMetaLinkedMetric(row, () => formatCallToActionText(row.cta_text) || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCallToActionText(row.cta_text) || "-")},
    {label: "Creative", cell: (row) => renderCreativeCell(row), csvValue: (row) => formatMetaLinkedMetric(row, () => row.creative_name || row.creative_id || "-")},
    {label: "Creative ID", cell: (row) => formatMetaLinkedMetric(row, () => row.creative_id || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.creative_id || "-")},
    {label: "UTM", cell: (row) => formatMetaLinkedMetric(row, () => row.url_tags || extractUtmString(row.final_url) || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.url_tags || extractUtmString(row.final_url) || "-")},
    {label: "Post ID", cell: (row) => formatMetaLinkedMetric(row, () => row.post_id || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.post_id || "-")},
    {label: "Preview Link", cell: (row) => formatMetaLinkedMetric(row, () => row.post_permalink || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.post_permalink || "-")},
    {label: "Campaign ID", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_id || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_id || "-")},
    {label: "Campaign Name", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_name || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_name || "-")},
    {label: "Campaign Objective", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_objective || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_objective || "-")},
    {label: "Campaign Effective Status", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_effective_status || row.campaign_status || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_effective_status || row.campaign_status || "-")},
    {label: "Campaign Buying Type", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_buying_type || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_buying_type || "-")},
    {label: "Ad Set ID", cell: (row) => formatMetaLinkedMetric(row, () => row.adset_id || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.adset_id || "-")},
    {label: "Ad Set Name", cell: (row) => formatMetaLinkedMetric(row, () => row.adset_name || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.adset_name || "-")},
    {label: "Ad Set Effective Status", cell: (row) => formatMetaLinkedMetric(row, () => row.adset_effective_status || row.adset_status || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.adset_effective_status || row.adset_status || "-")},
    {label: "Optimization Goal", cell: (row) => formatMetaLinkedMetric(row, () => row.optimization_goal || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.optimization_goal || "-")},
    {label: "Optimization Event", cell: (row) => formatMetaLinkedMetric(row, () => row.optimization_event || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.optimization_event || "-")},
    {label: "Billing Event", cell: (row) => formatMetaLinkedMetric(row, () => row.billing_event || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.billing_event || "-")},
    {label: "Bid Strategy", cell: (row) => formatMetaLinkedMetric(row, () => row.bid_strategy || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.bid_strategy || "-")},
    {label: "Daily Budget", cell: (row) => formatMetaLinkedMetric(row, () => formatMinorUnitCurrency(row.daily_budget, metaCurrency, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMinorUnitCurrency(row.daily_budget, metaCurrency, 2))},
    {label: "Attribution Spec", cell: (row) => formatMetaLinkedMetric(row, () => formatAttributionSpecValue(row.attribution_spec)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatAttributionSpecValue(row.attribution_spec))},
    {label: "Publisher Platforms", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.publisher_platforms)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.publisher_platforms))},
    {label: "Facebook Positions", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.facebook_positions)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.facebook_positions))},
    {label: "Instagram Positions", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.instagram_positions)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.instagram_positions))},
    {label: "Device Platforms", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.device_platforms)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.device_platforms))},
    {label: "Countries", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.countries)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.countries))},
    {label: "Active From", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaDateTime(row.start_time, metaTimezone)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaDateTime(row.start_time, metaTimezone))},
    {label: "Active Until", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaEndTime(row.end_time, metaTimezone)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaEndTime(row.end_time, metaTimezone))},
    {label: "Spend", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.spend, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.spend, 2, metaCurrency))},
    {label: "Impressions", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.impressions).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.impressions).toLocaleString())},
    {label: "Unique Outbound Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.unique_outbound_clicks || 0).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.unique_outbound_clicks || 0).toLocaleString())},
    {label: "Outbound Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.outbound_clicks || 0).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.outbound_clicks || 0).toLocaleString())},
    {label: "Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.clicks).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.clicks).toLocaleString())},
    {label: "Impr / €", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.impressionsPerEuro, 1)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.impressionsPerEuro, 1))},
    {label: "Clicks / €", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.clicksPerEuro, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.clicksPerEuro, 2))},
    {label: "CTR", cell: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.ctr, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.ctr, 2))},
    {label: "CPC", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpc, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpc, 2, metaCurrency))},
    {label: "Frequency", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.frequency, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.frequency, 2))},
    {label: "CPM", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpm, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpm, 2, metaCurrency))},
    {label: "Signups (coaches_public)", cell: (row) => row.signups, csvValue: (row) => row.signups},
    {label: "Results", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaResultCountValue(row.result_count)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaResultCountValue(row.result_count))},
    {label: "Cost / Result", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cost_per_result, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cost_per_result, 2, metaCurrency))},
    {label: "% Powerlifter", cell: (row) => formatPercent(row.powerliftersRate, 2), csvValue: (row) => formatPercent(row.powerliftersRate, 2)},
    {label: "% Bodybuilder", cell: (row) => formatPercent(row.bodybuildersRate, 2), csvValue: (row) => formatPercent(row.bodybuildersRate, 2)},
    {label: "% Other", cell: (row) => formatPercent(row.otherRate, 2), csvValue: (row) => formatPercent(row.otherRate, 2)},
    {label: "Invited", cell: (row) => row.invited, csvValue: (row) => row.invited},
    {label: "Viewed Block", cell: (row) => row.blocked, csvValue: (row) => row.blocked},
    {label: "Athlete App", cell: (row) => row.athleteShown, csvValue: (row) => row.athleteShown},
    {label: "Paid", cell: (row) => row.paid, csvValue: (row) => row.paid},
    {label: "Signup Rate from Click", cell: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.clickToSignupRate, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.clickToSignupRate, 2))},
    {label: "Signup to Paid", cell: (row) => formatPercent(row.paidRate, 2), csvValue: (row) => formatPercent(row.paidRate, 2)},
    {label: "Cost / Signup", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.costPerSignup, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.costPerSignup, 2, metaCurrency))},
    {label: "CAC", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cac, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cac, 2, metaCurrency))},
    {label: "ROAS", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.roas, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.roas, 2))},
  ];

  const adsetTableColumns = [
    {label: "Campaign ID", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_id || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_id || "-")},
    {label: "Campaign Name", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_name || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_name || "-")},
    {label: "Campaign Objective", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_objective || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_objective || "-")},
    {label: "Campaign Effective Status", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_effective_status || row.campaign_status || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_effective_status || row.campaign_status || "-")},
    {label: "Campaign Buying Type", cell: (row) => formatMetaLinkedMetric(row, () => row.campaign_buying_type || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.campaign_buying_type || "-")},
    {label: "Ad Set ID", cell: (row) => row.adset_id, csvValue: (row) => row.adset_id},
    {label: "Ad Set Name", cell: (row) => formatMetaLinkedMetric(row, () => row.adset_name || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.adset_name || "-")},
    {label: "Ad Set Effective Status", cell: (row) => formatMetaLinkedMetric(row, () => row.adset_effective_status || row.adset_status || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.adset_effective_status || row.adset_status || "-")},
    {label: "Optimization Goal", cell: (row) => formatMetaLinkedMetric(row, () => row.optimization_goal || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.optimization_goal || "-")},
    {label: "Optimization Event", cell: (row) => formatMetaLinkedMetric(row, () => row.optimization_event || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.optimization_event || "-")},
    {label: "Billing Event", cell: (row) => formatMetaLinkedMetric(row, () => row.billing_event || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.billing_event || "-")},
    {label: "Bid Strategy", cell: (row) => formatMetaLinkedMetric(row, () => row.bid_strategy || "-"), csvValue: (row) => formatMetaLinkedMetric(row, () => row.bid_strategy || "-")},
    {label: "Daily Budget", cell: (row) => formatMetaLinkedMetric(row, () => formatMinorUnitCurrency(row.daily_budget, metaCurrency, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMinorUnitCurrency(row.daily_budget, metaCurrency, 2))},
    {label: "Attribution Spec", cell: (row) => formatMetaLinkedMetric(row, () => formatAttributionSpecValue(row.attribution_spec)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatAttributionSpecValue(row.attribution_spec))},
    {label: "Publisher Platforms", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.publisher_platforms)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.publisher_platforms))},
    {label: "Facebook Positions", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.facebook_positions)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.facebook_positions))},
    {label: "Instagram Positions", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.instagram_positions)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.instagram_positions))},
    {label: "Device Platforms", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.device_platforms)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.device_platforms))},
    {label: "Countries", cell: (row) => formatMetaLinkedMetric(row, () => formatListValue(row.countries)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatListCsv(row.countries))},
    {label: "Active From", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaDateTime(row.start_time, metaTimezone)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaDateTime(row.start_time, metaTimezone))},
    {label: "Active Until", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaEndTime(row.end_time, metaTimezone)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaEndTime(row.end_time, metaTimezone))},
    {label: "Ads", cell: (row) => row.ad_count, csvValue: (row) => row.ad_count},
    {label: "Spend", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.spend, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.spend, 2, metaCurrency))},
    {label: "Impressions", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.impressions).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.impressions).toLocaleString())},
    {label: "Unique Outbound Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.unique_outbound_clicks || 0).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.unique_outbound_clicks || 0).toLocaleString())},
    {label: "Outbound Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.outbound_clicks || 0).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.outbound_clicks || 0).toLocaleString())},
    {label: "Clicks", cell: (row) => formatMetaLinkedMetric(row, () => Math.round(row.clicks).toLocaleString()), csvValue: (row) => formatMetaLinkedMetric(row, () => Math.round(row.clicks).toLocaleString())},
    {label: "CTR", cell: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.ctr, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.ctr, 2))},
    {label: "CPC", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpc, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpc, 2, metaCurrency))},
    {label: "Frequency", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.frequency, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.frequency, 2))},
    {label: "CPM", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpm, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cpm, 2, metaCurrency))},
    {label: "Signups (coaches_public)", cell: (row) => row.signups, csvValue: (row) => row.signups},
    {label: "Results", cell: (row) => formatMetaLinkedMetric(row, () => formatMetaResultCountValue(row.result_count)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatMetaResultCountValue(row.result_count))},
    {label: "Cost / Result", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cost_per_result, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cost_per_result, 2, metaCurrency))},
    {label: "% Powerlifter", cell: (row) => formatPercent(row.powerliftersRate, 2), csvValue: (row) => formatPercent(row.powerliftersRate, 2)},
    {label: "% Bodybuilder", cell: (row) => formatPercent(row.bodybuildersRate, 2), csvValue: (row) => formatPercent(row.bodybuildersRate, 2)},
    {label: "% Other", cell: (row) => formatPercent(row.otherRate, 2), csvValue: (row) => formatPercent(row.otherRate, 2)},
    {label: "Invited", cell: (row) => row.invited, csvValue: (row) => row.invited},
    {label: "Viewed Block", cell: (row) => row.blocked, csvValue: (row) => row.blocked},
    {label: "Athlete App", cell: (row) => row.athleteShown, csvValue: (row) => row.athleteShown},
    {label: "Paid", cell: (row) => row.paid, csvValue: (row) => row.paid},
    {label: "Signup Rate from Click", cell: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.clickToSignupRate, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatPercent(row.clickToSignupRate, 2))},
    {label: "Signup to Paid", cell: (row) => formatPercent(row.signupToPaidRate, 2), csvValue: (row) => formatPercent(row.signupToPaidRate, 2)},
    {label: "Cost / Signup", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.costPerSignup, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.costPerSignup, 2, metaCurrency))},
    {label: "CAC", cell: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cac, 2, metaCurrency)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatCurrency(row.cac, 2, metaCurrency))},
    {label: "ROAS", cell: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.roas, 2)), csvValue: (row) => formatMetaLinkedMetric(row, () => formatNumber(row.roas, 2))},
  ];

  const exportableAdRows = tableRows.filter((row) => row.ad_id !== INFERRED_PAID_UNKNOWN);
  const exportableAdsetRows = adsetTableRows;
  const assetFiles = Array.from(
    new Map(
      exportableAdRows
        .filter((row) => row.hasMetaAttributionLink && (row.creative_asset_url || row.creative_thumbnail_url))
        .map((row) => {
          const assetUrl = row.creative_asset_url || row.creative_thumbnail_url;
          const key = row.creative_id || assetUrl;
          return [
            key,
            {
              url: assetUrl,
              name:
                buildAssetBaseName([
                  row.creative_id ? `creative-${row.creative_id}` : null,
                  row.ad_id ? `ad-${row.ad_id}` : null,
                  row.campaign_name || row.campaign_id,
                  row.ad_name || row.ad_id,
                  row.creative_name || row.creative_id || "creative",
                ]) || `creative-${row.creative_id || row.ad_id || "asset"}`,
            },
          ];
        }),
    ).values(),
  );

  const exportAdTable = () => {
    downloadCsv(
      `ad-table-${startDate}-to-${endDate}.csv`,
      adTableColumns,
      exportableAdRows,
    );
  };

  const exportAssetFiles = async () => {
    if (assetFiles.length === 0 || assetExporting) return;
    setAssetExporting(true);
    try {
      await downloadAssetZip(`ad-assets-${startDate}-to-${endDate}.zip`, assetFiles);
    } catch (error) {
      window.alert(error?.message || "Failed to export asset files.");
    } finally {
      setAssetExporting(false);
    }
  };

  const exportAdsetTable = () => {
    downloadCsv(
      `adset-table-${startDate}-to-${endDate}.csv`,
      adsetTableColumns,
      exportableAdsetRows,
    );
  };

  const overallImpressionsPerEuro =
    derived.metaTotals.spend > 0
      ? derived.metaTotals.impressions / derived.metaTotals.spend
      : null;
  const overallClicksPerEuro =
    derived.metaTotals.spend > 0
      ? derived.metaTotals.clicks / derived.metaTotals.spend
      : null;
  const overallCtr =
    derived.metaTotals.impressions > 0
      ? derived.metaTotals.clicks / derived.metaTotals.impressions
      : null;
  const overallCpc =
    derived.metaTotals.clicks > 0
      ? derived.metaTotals.spend / derived.metaTotals.clicks
      : null;
  const overallCpm =
    derived.metaTotals.impressions > 0
      ? (derived.metaTotals.spend * 1000) / derived.metaTotals.impressions
      : null;

  const overallCostPerSignup =
    derived.funnelTotals.signups > 0
      ? derived.metaTotals.spend / derived.funnelTotals.signups
      : null;
  const overallCac =
    derived.funnelTotals.paid > 0
      ? derived.metaTotals.spend / derived.funnelTotals.paid
      : null;
  const overallRoas =
    derived.metaTotals.spend > 0
      ? derived.funnelTotals.revenue / derived.metaTotals.spend
      : null;
  const paidAttributedSignups =
    derived.attributionTotals.trackedSignups + derived.attributionTotals.inferredSignups;
  const inferredShare =
    paidAttributedSignups > 0 ? derived.attributionTotals.inferredSignups / paidAttributedSignups : null;
  const trackedSignupToPaidRate = computeCohortRate(
    derived.funnelAttribution.paid,
    derived.funnelAttribution.signups,
    "tracked",
  );
  const inferredSignupToPaidRate = computeCohortRate(
    derived.funnelAttribution.paid,
    derived.funnelAttribution.signups,
    "inferred",
  );
  const trackedCostPerSignup =
    derived.attributionTotals.trackedSignups > 0
      ? derived.metaTotals.spend / derived.attributionTotals.trackedSignups
      : null;
  const trackedCac =
    derived.attributionTotals.trackedPaid > 0
      ? derived.metaTotals.spend / derived.attributionTotals.trackedPaid
      : null;

  const chartBaseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: palette.muted,
          boxWidth: 8,
          boxHeight: 8,
          useBorderRadius: true,
          borderRadius: 4,
          font: {
            family: "Inter, sans-serif",
            size: 11,
            weight: "500",
          },
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: "#171717",
        titleColor: "#FFFFFF",
        bodyColor: "#E5E7EB",
        borderColor: "transparent",
        borderWidth: 0,
        cornerRadius: 6,
        padding: 12,
        titleFont: {
          family: "Inter, sans-serif",
          weight: "600",
          size: 13,
        },
        bodyFont: {
          family: "Inter, sans-serif",
          weight: "400",
          size: 12,
        },
        displayColors: true,
        boxPadding: 4,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
          drawBorder: false,
        },
        ticks: {
          color: palette.muted,
          font: {
            family: "Inter, sans-serif",
            size: 10,
          },
        },
        border: {
          display: false,
        },
      },
      y: {
        grid: {
          color: palette.grid,
          drawBorder: false,
          tickLength: 0,
        },
        ticks: {
          color: palette.muted,
          padding: 10,
          font: {
            family: "Inter, sans-serif",
            size: 10,
          },
        },
        border: {
          display: false,
        },
        beginAtZero: true,
      },
    },
    interaction: {
      mode: "index",
      intersect: false,
    },
  };

  const handleSignIn = async () => {
    setError("");
    if (!auth || !googleProvider) {
      setError("Firebase Auth is not initialized.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err?.message || "Sign-in failed");
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const isTasksRoute = currentRoute === APP_ROUTES.tasks;
  const tasksBackend = import.meta.env.VITE_TASKS_BACKEND || "firebase";
  const operationsDemoEnabled = isTasksRoute && tasksBackend === "mock";
  const sessionUser = operationsDemoEnabled && !user ? DEMO_USER : user;

  if (!authReady && !operationsDemoEnabled) {
    return (
      <div className="app-shell">
        <div className="card">Loading authentication...</div>
      </div>
    );
  }

  if (isTasksRoute) {
    if (!sessionUser) {
      return (
        <div className="app-shell">
          <div className="card auth-card">
            <div className="eyebrow">Internal operations</div>
            <h1>Efort Center</h1>
            <p>Sign in with Google to access tasks and templates.</p>
            <button className="primary" onClick={handleSignIn}>
              Sign in with Google
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      );
    }

    if (!operationsDemoEnabled && !isAdmin) {
      return (
        <div className="app-shell">
          <div className="card auth-card">
            <div className="eyebrow">Access denied</div>
            <h1>Efort Center</h1>
            <p>Your account is not authorized for this workspace.</p>
            <button className="secondary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="operations-shell">
        <SiteMenu
          currentRoute={currentRoute}
          onNavigate={navigateTo}
          sessionUser={sessionUser}
          onSignOut={handleSignOut}
          showSignOut={!operationsDemoEnabled}
        />
        <div className="operations-main">
          <main className="page-shell">
            <TasksPage />
          </main>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell">
        <div className="card auth-card">
          <div className="eyebrow">Internal analytics</div>
          <h1>Efort Center</h1>
          <p>Sign in with Google to access internal dashboards.</p>
          <button className="primary" onClick={handleSignIn}>
            Sign in with Google
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="app-shell">
        <div className="card auth-card">
          <div className="eyebrow">Access denied</div>
          <h1>Efort Center</h1>
          <p>Your account is not authorized for this dashboard.</p>
          <button className="secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="operations-shell">
      <SiteMenu
        currentRoute={currentRoute}
        onNavigate={navigateTo}
        sessionUser={user}
        onSignOut={handleSignOut}
        showSignOut
      />
      <div className="operations-main">
        <main className="page-shell">
          {currentRoute === APP_ROUTES.feedback ? (
            <FeedbackPage />
          ) : (
            <>
              <header className="top-bar">
                <div>
                  <div className="eyebrow">Efort internal analytics</div>
                  <h1>Ad Funnel Dashboard</h1>
                </div>
              </header>
              <section className="controls card">
        <div className="scope-control">
          <label>Audience</label>
          <div className="segmented" role="tablist" aria-label="Audience scope">
            <button
              type="button"
              className={audienceScope === "ads_only" ? "segment active" : "segment"}
              onClick={() => setAudienceScope("ads_only")}
            >
              Ads only
            </button>
            <button
              type="button"
              className={audienceScope === "all" ? "segment active" : "segment"}
              onClick={() => setAudienceScope("all")}
            >
              All coaches
            </button>
          </div>
        </div>
        <div>
          <label>Start</label>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div>
          <label>End</label>
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div>
          <label>Campaign</label>
          <select
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
          >
            <option value="all">All</option>
            {campaignOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Adset</label>
          <select
            value={adsetFilter}
            onChange={(event) => setAdsetFilter(event.target.value)}
          >
            <option value="all">All</option>
            {adsetOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Ad</label>
          <select value={adFilter} onChange={(event) => setAdFilter(event.target.value)}>
            <option value="all">All</option>
            {adOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => loadData(true)}>
            Refresh
          </button>
        </div>
      </section>

      {(error || metaError) && (
        <section className="card status-card">
          {error && <p className="error">{error}</p>}
          {metaError && <p className="error">Meta warning: {metaError}</p>}
        </section>
      )}

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Chapter 1: Top Funnel Efficiency</h2>
            <p className="muted">
              Delivery metrics come from Meta. The key efficiency metrics are
              impressions per euro and clicks per euro, plus CTR, CPC, and CPM.
            </p>
          </div>
          {loading && <span className="muted">Loading...</span>}
        </div>

        <div className="kpi-grid">
          <div className="card kpi-card">
            <h3>Spend</h3>
            <div className="value">{formatCurrency(derived.metaTotals.spend, 2, metaCurrency)}</div>
            <div className="sub">Meta</div>
          </div>
          <div className="card kpi-card">
            <h3>Impressions</h3>
            <div className="value">{Math.round(derived.metaTotals.impressions).toLocaleString()}</div>
            <div className="sub">Meta</div>
          </div>
          <div className="card kpi-card">
            <h3>Clicks</h3>
            <div className="value">{Math.round(derived.metaTotals.clicks).toLocaleString()}</div>
            <div className="sub">Meta</div>
          </div>
          <div className="card kpi-card">
            <h3>Impressions / €</h3>
            <div className="value">{formatNumber(overallImpressionsPerEuro, 1)}</div>
            <div className="sub">Impressions ÷ spend</div>
          </div>
          <div className="card kpi-card">
            <h3>Clicks / €</h3>
            <div className="value">{formatNumber(overallClicksPerEuro, 2)}</div>
            <div className="sub">Clicks ÷ spend</div>
          </div>
          <div className="card kpi-card">
            <h3>CTR</h3>
            <div className="value">{formatPercent(overallCtr, 2)}</div>
            <div className="sub">Clicks ÷ impressions</div>
          </div>
          <div className="card kpi-card">
            <h3>CPC</h3>
            <div className="value">{formatCurrency(overallCpc, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ clicks</div>
          </div>
          <div className="card kpi-card">
            <h3>CPM</h3>
            <div className="value">{formatCurrency(overallCpm, 2, metaCurrency)}</div>
            <div className="sub">Cost per 1000 impressions</div>
          </div>
        </div>

        <div className="chart-grid chart-grid-top">
          <div className="card chart-card">
            <h3>Impressions per Euro by Ad</h3>
            {derived.topBySpend.length === 0 ? (
              <p>No Meta spend data in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: derived.topBySpend.map((row) => row.ad_id),
                    datasets: [
                      {
                        label: "Impressions / €",
                        data: derived.topBySpend.map((row) => row.impressionsPerEuro || 0),
                        backgroundColor: "rgba(63, 123, 141, 0.72)",
                        borderRadius: 6,
                      },
                    ],
                  }}
                  options={chartBaseOptions}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Clicks per Euro by Ad</h3>
            {derived.topBySpend.length === 0 ? (
              <p>No Meta spend data in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: derived.topBySpend.map((row) => row.ad_id),
                    datasets: [
                      {
                        label: "Clicks / €",
                        data: derived.topBySpend.map((row) => row.clicksPerEuro || 0),
                        backgroundColor: "rgba(99, 91, 255, 0.68)",
                        borderRadius: 6,
                      },
                    ],
                  }}
                  options={chartBaseOptions}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Daily Spend and Clicks</h3>
            {derived.metaSeries.labels.length === 0 ? (
              <p>No Meta time-series data in this range.</p>
            ) : (
              <div className="chart-area">
                <Line
                  data={{
                    labels: derived.metaSeries.labels,
                    datasets: [
                      {
                        label: "Spend",
                        data: derived.metaSeries.spend,
                        borderColor: palette.brand,
                        backgroundColor: "rgba(63, 123, 141, 0.14)",
                        yAxisID: "y",
                        tension: 0.3,
                        fill: true,
                      },
                      {
                        label: "Clicks",
                        data: derived.metaSeries.clicks,
                        borderColor: palette.accent,
                        backgroundColor: "rgba(99, 91, 255, 0.14)",
                        yAxisID: "y1",
                        tension: 0.3,
                      },
                    ],
                  }}
                  options={{
                    ...chartBaseOptions,
                    scales: {
                      x: chartBaseOptions.scales.x,
                      y: {
                        ...chartBaseOptions.scales.y,
                        position: "left",
                      },
                      y1: {
                        ...chartBaseOptions.scales.y,
                        position: "right",
                        grid: {drawOnChartArea: false},
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Attribution Confidence Over Time</h3>
            {derived.coachSeries.labels.length === 0 ? (
              <p>No signup attribution data in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: derived.coachSeries.labels,
                    datasets: [
                      {
                        label: "Tracked paid (fbclid)",
                        data: derived.coachSeries.trackedSignups,
                        backgroundColor: "rgba(63, 123, 141, 0.72)",
                        borderRadius: 4,
                      },
                      {
                        label: "Inferred paid (US/GB)",
                        data: derived.coachSeries.inferredSignups,
                        backgroundColor: "rgba(224, 170, 82, 0.75)",
                        borderRadius: 4,
                      },
                    ],
                  }}
                  options={{
                    ...chartBaseOptions,
                    scales: {
                      x: {
                        ...chartBaseOptions.scales.x,
                        stacked: true,
                      },
                      y: {
                        ...chartBaseOptions.scales.y,
                        stacked: true,
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Daily Athlete Type Mix (100%)</h3>
            {derived.athleteTypeDailyDistribution.labels.length === 0 ? (
              <p>No onboarding athlete-type responses in this range.</p>
            ) : (
              <>
                <div className="chart-area">
                  <Bar
                    data={{
                      labels: derived.athleteTypeDailyDistribution.labels,
                      datasets: [
                        {
                          label: "Powerlifters",
                          data: derived.athleteTypeDailyDistribution.powerlifters,
                          responseCounts: derived.athleteTypeDailyDistribution.powerliftersCounts,
                          backgroundColor: "rgba(63, 123, 141, 0.72)",
                          borderRadius: 4,
                        },
                        {
                          label: "Bodybuilders",
                          data: derived.athleteTypeDailyDistribution.bodybuilders,
                          responseCounts: derived.athleteTypeDailyDistribution.bodybuildersCounts,
                          backgroundColor: "rgba(99, 91, 255, 0.68)",
                          borderRadius: 4,
                        },
                        {
                          label: "Other",
                          data: derived.athleteTypeDailyDistribution.other,
                          responseCounts: derived.athleteTypeDailyDistribution.otherCounts,
                          backgroundColor: "rgba(214, 138, 66, 0.68)",
                          borderRadius: 6,
                        },
                      ],
                    }}
                    options={{
                      ...chartBaseOptions,
                      plugins: {
                        ...chartBaseOptions.plugins,
                        tooltip: {
                          ...chartBaseOptions.plugins.tooltip,
                          callbacks: {
                            label: (context) => {
                              const percentage = Number(context.parsed?.y ?? 0);
                              const counts = Array.isArray(context.dataset.responseCounts)
                                ? context.dataset.responseCounts
                                : [];
                              const responseCount = Number(counts[context.dataIndex] || 0);
                              return `${context.dataset.label}: ${formatNumber(percentage, 1)}% (${responseCount})`;
                            },
                            afterBody: (items) => {
                              if (!items || items.length === 0) return "";
                              const dataIndex = items[0].dataIndex;
                              const totalResponses = Number(
                                derived.athleteTypeDailyDistribution.totalResponsesByDate[dataIndex] || 0,
                              );
                              return `Total: (${totalResponses})`;
                            },
                          },
                        },
                      },
                      scales: {
                        ...chartBaseOptions.scales,
                        x: {
                          ...chartBaseOptions.scales.x,
                          stacked: true,
                        },
                        y: {
                          ...chartBaseOptions.scales.y,
                          stacked: true,
                          max: 100,
                          ticks: {
                            ...chartBaseOptions.scales.y.ticks,
                            callback: (value) => `${value}%`,
                          },
                        },
                      },
                    }}
                  />
                </div>
                <p className="chart-footnote">
                  Each day is normalized to 100%. Multi-select responses are counted
                  separately; missing athlete types are excluded.
                </p>
              </>
            )}
          </div>

          <div className="card chart-card">
            <h3>Daily Coach Athlete-Type Mix (Counts)</h3>
            {derived.athleteTypeDailyCoachMix.labels.length === 0 ? (
              <p>No onboarding athlete-type responses in this range.</p>
            ) : (
              <>
                <div className="chart-area">
                  <Bar
                    data={{
                      labels: derived.athleteTypeDailyCoachMix.labels,
                      datasets: [
                        {
                          label: "Only Powerlifting",
                          data: derived.athleteTypeDailyCoachMix.onlyPowerlifting,
                          backgroundColor: "rgba(63, 123, 141, 0.72)",
                          borderRadius: 4,
                        },
                        {
                          label: "Only Bodybuilding",
                          data: derived.athleteTypeDailyCoachMix.onlyBodybuilding,
                          backgroundColor: "rgba(99, 91, 255, 0.68)",
                          borderRadius: 4,
                        },
                        {
                          label: "Powerlifting + Bodybuilding",
                          data: derived.athleteTypeDailyCoachMix.powerliftingAndBodybuilding,
                          backgroundColor: "rgba(47, 182, 124, 0.68)",
                          borderRadius: 4,
                        },
                        {
                          label: "Other",
                          data: derived.athleteTypeDailyCoachMix.other,
                          backgroundColor: "rgba(214, 138, 66, 0.68)",
                          borderRadius: 6,
                        },
                      ],
                    }}
                    options={{
                      ...chartBaseOptions,
                      scales: {
                        ...chartBaseOptions.scales,
                        x: {
                          ...chartBaseOptions.scales.x,
                          stacked: true,
                        },
                        y: {
                          ...chartBaseOptions.scales.y,
                          stacked: true,
                        },
                      },
                    }}
                  />
                </div>
                <p className="chart-footnote">
                  Each coach is counted once per day based on their onboarding athlete-type selection.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Chapter 2: Signup to Paid Funnel</h2>
            <p className="muted">
              Funnel and attribution counts come from coaches_public. Spend comes
              from Meta and powers cost metrics where ad linkage exists.
            </p>
          </div>
        </div>

        <div className="kpi-grid attribution-kpi-grid">
          <div className="card kpi-card">
            <h3>Tracked Signups</h3>
            <div className="value">{derived.attributionTotals.trackedSignups}</div>
            <div className="sub">Has <code>fbclid</code></div>
          </div>
          <div className="card kpi-card">
            <h3>Inferred Signups</h3>
            <div className="value">{derived.attributionTotals.inferredSignups}</div>
            <div className="sub">No <code>fbclid</code>, country <code>US</code> or <code>GB</code></div>
          </div>
          <div className="card kpi-card">
            <h3>Inferred Share</h3>
            <div className="value">{formatPercent(inferredShare, 2)}</div>
            <div className="sub">Inferred ÷ (tracked + inferred)</div>
          </div>
        </div>

        <div className="kpi-grid">
          <div className="card kpi-card">
            <h3>Signups</h3>
            <div className="value">{derived.funnelTotals.signups}</div>
            <div className="sub">{renderTrackedInferredSummary(derived.funnelAttribution.signups)}</div>
          </div>
          <div className="card kpi-card">
            <h3>Invited Client</h3>
            <div className="value">{derived.funnelTotals.invited}</div>
            <div className="sub">{renderTrackedInferredSummary(derived.funnelAttribution.invited)}</div>
          </div>
          <div className="card kpi-card">
            <h3>Viewed Block</h3>
            <div className="value">{derived.funnelTotals.blocked}</div>
            <div className="sub">{renderTrackedInferredSummary(derived.funnelAttribution.blocked)}</div>
          </div>
          <div className="card kpi-card">
            <h3>Shown Athlete App</h3>
            <div className="value">{derived.funnelTotals.athleteShown}</div>
            <div className="sub">{renderTrackedInferredSummary(derived.funnelAttribution.athleteShown)}</div>
          </div>
          <div className="card kpi-card">
            <h3>Paid</h3>
            <div className="value">{derived.funnelTotals.paid}</div>
            <div className="sub">{renderTrackedInferredSummary(derived.funnelAttribution.paid)}</div>
          </div>
          <div className="card kpi-card">
            <h3>Tracked Signup to Paid</h3>
            <div className="value">{formatPercent(trackedSignupToPaidRate, 2)}</div>
            <div className="sub">Tracked paid ÷ tracked signups</div>
          </div>
          <div className="card kpi-card">
            <h3>Inferred Signup to Paid</h3>
            <div className="value">{formatPercent(inferredSignupToPaidRate, 2)}</div>
            <div className="sub">Inferred paid ÷ inferred signups</div>
          </div>
          <div className="card kpi-card">
            <h3>Cost per Signup</h3>
            <div className="value">{formatCurrency(overallCostPerSignup, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ signups</div>
          </div>
          <div className="card kpi-card">
            <h3>Tracked Cost / Signup</h3>
            <div className="value">{formatCurrency(trackedCostPerSignup, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ tracked signups</div>
          </div>
          <div className="card kpi-card">
            <h3>CAC</h3>
            <div className="value">{formatCurrency(overallCac, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ paid</div>
          </div>
          <div className="card kpi-card">
            <h3>Tracked CAC</h3>
            <div className="value">{formatCurrency(trackedCac, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ tracked paid</div>
          </div>
          <div className="card kpi-card">
            <h3>Estimated MRR</h3>
            <div className="value">{formatCurrency(derived.funnelTotals.revenue, 2, "EUR")}</div>
            <div className="sub">From price IDs</div>
          </div>
          <div className="card kpi-card">
            <h3>ROAS</h3>
            <div className="value">{formatNumber(overallRoas, 2)}</div>
            <div className="sub">MRR ÷ spend</div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="card chart-card">
            <h3>Total Funnel Stages</h3>
            {derived.funnelTotals.signups === 0 ? (
              <p>No signup data in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: [
                      "Signups",
                      "Invited client",
                      "Viewed block",
                      "Shown athlete app",
                      "Paid",
                    ],
                    datasets: [
                      {
                        label: "Coaches",
                        data: [
                          derived.funnelTotals.signups,
                          derived.funnelTotals.invited,
                          derived.funnelTotals.blocked,
                          derived.funnelTotals.athleteShown,
                          derived.funnelTotals.paid,
                        ],
                        backgroundColor: [
                          "rgba(63, 123, 141, 0.74)",
                          "rgba(99, 91, 255, 0.68)",
                          "rgba(47, 182, 124, 0.68)",
                          "rgba(214, 138, 66, 0.68)",
                          "rgba(206, 95, 127, 0.68)",
                        ],
                        borderRadius: 6,
                      },
                    ],
                  }}
                  options={{
                    ...chartBaseOptions,
                    indexAxis: "y",
                  }}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Conversion Rates by Ad</h3>
            {derived.topBySignups.length === 0 ? (
              <p>No ad signups in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: derived.topBySignups.map((row) => row.ad_id),
                    datasets: [
                      {
                        label: "Invite rate",
                        data: derived.topBySignups.map((row) => (row.inviteRate || 0) * 100),
                        backgroundColor: "rgba(99, 91, 255, 0.62)",
                        borderRadius: 4,
                      },
                      {
                        label: "Athlete app rate",
                        data: derived.topBySignups.map((row) => (row.athleteRate || 0) * 100),
                        backgroundColor: "rgba(63, 123, 141, 0.62)",
                        borderRadius: 4,
                      },
                      {
                        label: "Paid rate",
                        data: derived.topBySignups.map((row) => (row.paidRate || 0) * 100),
                        backgroundColor: "rgba(47, 182, 124, 0.62)",
                        borderRadius: 4,
                      },
                    ],
                  }}
                  options={{
                    ...chartBaseOptions,
                    scales: {
                      ...chartBaseOptions.scales,
                      y: {
                        ...chartBaseOptions.scales.y,
                        ticks: {
                          ...chartBaseOptions.scales.y.ticks,
                          callback: (value) => `${value}%`,
                        },
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>

          <div className="card chart-card">
            <h3>Cost per Signup vs CAC by Ad</h3>
            {topBySignupsWithMeta.length === 0 ? (
              <p>No Meta-linked ad signups in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: topBySignupsWithMeta.map((row) => row.ad_id),
                    datasets: [
                      {
                        label: "Cost per signup",
                        data: topBySignupsWithMeta.map((row) => row.costPerSignup),
                        backgroundColor: "rgba(63, 123, 141, 0.62)",
                        borderRadius: 4,
                      },
                      {
                        label: "CAC",
                        data: topBySignupsWithMeta.map((row) => row.cac),
                        backgroundColor: "rgba(206, 95, 127, 0.62)",
                        borderRadius: 4,
                      },
                    ],
                  }}
                  options={chartBaseOptions}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-header">
          <div>
            <h2>Ad-Level Funnel Table</h2>
            <div className="table-meta">
              <span className="muted">Timezone: {metaTimezone}</span>
            </div>
          </div>
          <div className="table-actions">
            <button className="secondary" onClick={exportAssetFiles} disabled={assetExporting || assetFiles.length === 0}>
              {assetExporting ? "Exporting Assets..." : "Export Asset Files"}
            </button>
            <button className="secondary" onClick={exportAdTable}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {adTableColumns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={adTableColumns.length}>No data for this range.</td>
                </tr>
              ) : (
                tableRows.map((row) => (
                  <tr key={row.id}>
                    {adTableColumns.map((column) => (
                      <td key={column.label}>{column.cell(row)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-header">
          <div>
            <h2>Ad Set Table</h2>
            <div className="table-meta">
              <span className="muted">Timezone: {metaTimezone}</span>
            </div>
          </div>
          <button className="secondary" onClick={exportAdsetTable}>
            Export CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {adsetTableColumns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adsetTableRows.length === 0 ? (
                <tr>
                  <td colSpan={adsetTableColumns.length}>No data for this range.</td>
                </tr>
              ) : (
                adsetTableRows.map((row) => (
                  <tr key={row.id}>
                    {adsetTableColumns.map((column) => (
                      <td key={column.label}>{column.cell(row)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card note-card">
        <h3>Attribution Logic</h3>
        <ul>
          <li>
            Delivery metrics (<code>impressions</code>, <code>clicks</code>,
            <code>spend</code>) are sourced only from Meta.
          </li>
          <li>
            Funnel and paid metrics are sourced from <code>coaches_public</code>
            and are preferred when both systems could overlap.
          </li>
          <li>
            In <code>Ads only</code>, coaches include tracked paid users
            (populated <code>fbclid</code>) and inferred paid users
            (missing <code>fbclid</code> with <code>signup_country_code</code> equal
            to <code>US</code> or <code>GB</code>).
          </li>
          <li>
            Coaches inferred via country without ad/adset/campaign metadata are
            grouped as <code>{INFERRED_PAID_UNKNOWN}</code> to quantify paid volume
            without assigning it to a specific ad creative.
          </li>
          <li>
            For rows without Meta ad linkage, spend-based ad metrics are shown as
            <code>N/A</code> to avoid false precision.
          </li>
        </ul>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

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
import {Bar, Doughnut, Line} from "react-chartjs-2";
import {auth, db, functions, googleProvider} from "./firebase";

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

const ANALYTICS_ADMIN_UID = "B2Xm8CFPyIS2taVlusbcIicWItF3";
const META_CALLABLE_NAME = "getMetaInsights";
const META_CACHE_TTL_MS = 20 * 60 * 1000;

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

function hasAdAttribution(record) {
  const value = record?.fbclid;
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return Boolean(value);
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

function incrementMap(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
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
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
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

function sourceBucket(record) {
  const source = normalizeKey(record?.utm_source, "unknown").toLowerCase();
  if (source.includes("instagram") || source === "ig") return "Instagram";
  if (source.includes("facebook") || source === "fb") return "Facebook";
  return "Other";
}

function createAdRow(id, adsetId = "unknown_adset", campaignId = "unknown_campaign") {
  return {
    id,
    ad_id: id,
    adset_id: adsetId,
    campaign_id: campaignId,
    signups: 0,
    invited: 0,
    blocked: 0,
    athleteShown: 0,
    paid: 0,
    revenue: 0,
    paidKnownRevenue: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
  };
}

function aggregateMetaRows(rows, filters) {
  const byAd = new Map();
  const byDate = new Map();

  let spend = 0;
  let impressions = 0;
  let clicks = 0;

  for (const row of rows) {
    if (filters.ad !== "all" && row.ad_id !== filters.ad) continue;
    if (filters.adset !== "all" && row.adset_id !== filters.adset) continue;
    if (filters.campaign !== "all" && row.campaign_id !== filters.campaign) continue;

    spend += row.spend;
    impressions += row.impressions;
    clicks += row.clicks;

    const adRow = getOrCreate(byAd, row.ad_id, () => ({
      ad_id: row.ad_id,
      adset_id: row.adset_id,
      campaign_id: row.campaign_id,
      spend: 0,
      impressions: 0,
      clicks: 0,
    }));
    adRow.spend += row.spend;
    adRow.impressions += row.impressions;
    adRow.clicks += row.clicks;

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
    totals: {spend, impressions, clicks},
    byAd,
    byDate,
  };
}

function computeAdMetrics(row) {
  const impressionsPerEuro = row.spend > 0 ? row.impressions / row.spend : null;
  const clicksPerEuro = row.spend > 0 ? row.clicks / row.spend : null;
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : null;
  const cpc = row.clicks > 0 ? row.spend / row.clicks : null;
  const cpm = row.impressions > 0 ? (row.spend * 1000) / row.impressions : null;
  const clickToSignupRate = row.clicks > 0 ? row.signups / row.clicks : null;
  const paidRate = row.signups > 0 ? row.paid / row.signups : null;
  const inviteRate = row.signups > 0 ? row.invited / row.signups : null;
  const blockRate = row.signups > 0 ? row.blocked / row.signups : null;
  const athleteRate = row.signups > 0 ? row.athleteShown / row.signups : null;
  const costPerSignup = row.signups > 0 ? row.spend / row.signups : null;
  const cac = row.paid > 0 ? row.spend / row.paid : null;
  const roas = row.spend > 0 ? row.revenue / row.spend : null;

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
    costPerSignup,
    cac,
    roas,
  };
}

export default function App() {
  const today = new Date();
  const defaultEnd = formatDateInput(today);
  const defaultStart = formatDateInput(addDays(today, -89));

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

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [audienceScope, setAudienceScope] = useState("ads_only");
  const [adsetFilter, setAdsetFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [adFilter, setAdFilter] = useState("all");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser || null);
      setAuthReady(true);
      if (!currentUser) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(currentUser.uid === ANALYTICS_ADMIN_UID);
    });
    return () => unsubscribe();
  }, []);

  const fetchMetaInsights = async ({since, until, forceRefresh = false}) => {
    if (!functions) {
      throw new Error("Firebase Functions is not initialized.");
    }

    const cacheKey = `meta:${since}:${until}`;
    if (!forceRefresh) {
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
            spend: metrics.spend,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
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
            spend: normalized.spend,
            impressions: normalized.impressions,
            clicks: normalized.clicks,
          });
        })
        .filter(Boolean);
    }

    const normalized = {
      rows,
      currency: payload.currency || "EUR",
      timezone: payload.timezone || "Europe/Berlin",
    };

    safeWriteCache(cacheKey, {
      cachedAt: Date.now(),
      rows,
      currency: normalized.currency,
      timezone: normalized.timezone,
    });

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
    if (isAdmin) {
      loadData(false);
    }
  }, [isAdmin, startDate, endDate]);

  const normalizedMetaRows = useMemo(() => {
    return metaRows.map((row) => ({
      ...row,
      ad_id: aliasKey(row.ad_id, adKeyAliases, "unknown_ad"),
      adset_id: aliasKey(row.adset_id, adsetKeyAliases, "unknown_adset"),
      campaign_id: aliasKey(row.campaign_id, campaignKeyAliases, "unknown_campaign"),
    }));
  }, [metaRows]);

  const scopedRecords = useMemo(() => {
    if (audienceScope === "all") return records;
    return records.filter((record) => hasAdAttribution(record));
  }, [records, audienceScope]);

  const adsetOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => aliasKey(item.utm_adset, adsetKeyAliases, "unknown_adset")),
      ...normalizedMetaRows.map((item) => item.adset_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const campaignOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => aliasKey(item.utm_campaign, campaignKeyAliases, "unknown_campaign")),
      ...normalizedMetaRows.map((item) => item.campaign_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const adOptions = useMemo(() => {
    return buildUniqueList([
      ...scopedRecords.map((item) => aliasKey(item.utm_content, adKeyAliases, "unknown_ad")),
      ...normalizedMetaRows.map((item) => item.ad_id),
    ]);
  }, [scopedRecords, normalizedMetaRows]);

  const filteredRecords = useMemo(() => {
    return scopedRecords.filter((record) => {
      const adValue = aliasKey(record.utm_content, adKeyAliases, "unknown_ad");
      const adsetValue = aliasKey(record.utm_adset, adsetKeyAliases, "unknown_adset");
      const campaignValue = aliasKey(record.utm_campaign, campaignKeyAliases, "unknown_campaign");

      if (adsetFilter !== "all" && adsetValue !== adsetFilter) return false;
      if (campaignFilter !== "all" && campaignValue !== campaignFilter) return false;
      if (adFilter !== "all" && adValue !== adFilter) return false;
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
    const sourceCounts = new Map();
    const coachesByDate = new Map();

    const funnelTotals = {
      signups: 0,
      invited: 0,
      blocked: 0,
      athleteShown: 0,
      paid: 0,
      revenue: 0,
      paidKnownRevenue: 0,
    };

    for (const record of filteredRecords) {
      const adId = aliasKey(record.utm_content, adKeyAliases, "unknown_ad");
      const adsetId = aliasKey(record.utm_adset, adsetKeyAliases, "unknown_adset");
      const campaignId = aliasKey(record.utm_campaign, campaignKeyAliases, "unknown_campaign");

      const row = getOrCreate(adMap, adId, () => createAdRow(adId, adsetId, campaignId));
      row.adset_id = row.adset_id || adsetId;
      row.campaign_id = row.campaign_id || campaignId;

      row.signups += 1;
      funnelTotals.signups += 1;

      const inviteCompleted = isStepCompleted(record, "onboarding_show_invite_client") === true;
      const blockCompleted = isStepCompleted(record, "onboarding_show_block") === true;
      const athleteShown = isStepCompleted(record, "onboarding_show_athlete_app") === true;
      const paid = record.has_paid === true;

      if (inviteCompleted) {
        row.invited += 1;
        funnelTotals.invited += 1;
      }
      if (blockCompleted) {
        row.blocked += 1;
        funnelTotals.blocked += 1;
      }
      if (athleteShown) {
        row.athleteShown += 1;
        funnelTotals.athleteShown += 1;
      }
      if (paid) {
        row.paid += 1;
        funnelTotals.paid += 1;
      }

      const priceId = record.subscription_price_id;
      const priceValue =
        priceId && Object.prototype.hasOwnProperty.call(priceCatalog, priceId)
          ? priceCatalog[priceId]
          : null;

      if (paid && priceValue !== null) {
        row.revenue += priceValue;
        row.paidKnownRevenue += 1;
        funnelTotals.revenue += priceValue;
        funnelTotals.paidKnownRevenue += 1;
      }

      incrementMap(sourceCounts, sourceBucket(record));

      const dateKey = toDateKey(record.trial_period_start_date);
      if (dateKey) {
        const dateRow = getOrCreate(coachesByDate, dateKey, () => ({
          signups: 0,
          paid: 0,
        }));
        dateRow.signups += 1;
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
      row.spend = meta.spend;
      row.impressions = meta.impressions;
      row.clicks = meta.clicks;
    }

    const adRows = Array.from(adMap.values()).map((row) => computeAdMetrics(row));

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
    };

    const channelLabels = ["Instagram", "Facebook", "Other"];
    const channelValues = channelLabels.map((label) => sourceCounts.get(label) || 0);

    return {
      adRows,
      topBySpend,
      topBySignups,
      metaSeries,
      coachSeries,
      funnelTotals,
      channelMix: {
        labels: channelLabels,
        values: channelValues,
      },
      metaTotals: metaAggregate.totals,
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

  const signupToPaidRate =
    derived.funnelTotals.signups > 0
      ? derived.funnelTotals.paid / derived.funnelTotals.signups
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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err?.message || "Sign-in failed");
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="app-shell">
        <div className="card">Loading authentication...</div>
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
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <div className="eyebrow">Efort internal analytics</div>
          <h1>Ad Funnel Dashboard</h1>
        </div>
        <div className="top-bar-actions">
          <span className="user-pill">{user.email}</span>
          <button className="secondary" onClick={handleSignOut}>
            Sign out
          </button>
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
            <h3>Channel Mix: Instagram vs Facebook</h3>
            {derived.channelMix.values.every((value) => value === 0) ? (
              <p>No UTM source data available.</p>
            ) : (
              <div className="chart-area">
                <Doughnut
                  data={{
                    labels: derived.channelMix.labels,
                    datasets: [
                      {
                        data: derived.channelMix.values,
                        backgroundColor: [
                          palette.accent,
                          palette.brand,
                          palette.slate,
                        ],
                        borderWidth: 0,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: chartBaseOptions.plugins,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Chapter 2: Signup to Paid Funnel</h2>
            <p className="muted">
              Funnel steps and paid conversion come from coaches_public, with spend
              from Meta to compute cost metrics.
            </p>
          </div>
        </div>

        <div className="kpi-grid">
          <div className="card kpi-card">
            <h3>Signups</h3>
            <div className="value">{derived.funnelTotals.signups}</div>
            <div className="sub">coaches_public</div>
          </div>
          <div className="card kpi-card">
            <h3>Invited Client</h3>
            <div className="value">{derived.funnelTotals.invited}</div>
            <div className="sub">Invite step completed</div>
          </div>
          <div className="card kpi-card">
            <h3>Viewed Block</h3>
            <div className="value">{derived.funnelTotals.blocked}</div>
            <div className="sub">Block step completed</div>
          </div>
          <div className="card kpi-card">
            <h3>Shown Athlete App</h3>
            <div className="value">{derived.funnelTotals.athleteShown}</div>
            <div className="sub">Athlete app step completed</div>
          </div>
          <div className="card kpi-card">
            <h3>Paid</h3>
            <div className="value">{derived.funnelTotals.paid}</div>
            <div className="sub">coaches_public</div>
          </div>
          <div className="card kpi-card">
            <h3>Signup to Paid</h3>
            <div className="value">{formatPercent(signupToPaidRate, 2)}</div>
            <div className="sub">Paid ÷ signups</div>
          </div>
          <div className="card kpi-card">
            <h3>Cost per Signup</h3>
            <div className="value">{formatCurrency(overallCostPerSignup, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ signups</div>
          </div>
          <div className="card kpi-card">
            <h3>CAC</h3>
            <div className="value">{formatCurrency(overallCac, 2, metaCurrency)}</div>
            <div className="sub">Spend ÷ paid</div>
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
            {derived.topBySignups.length === 0 ? (
              <p>No ad signups in this range.</p>
            ) : (
              <div className="chart-area">
                <Bar
                  data={{
                    labels: derived.topBySignups.map((row) => row.ad_id),
                    datasets: [
                      {
                        label: "Cost per signup",
                        data: derived.topBySignups.map((row) => row.costPerSignup || 0),
                        backgroundColor: "rgba(63, 123, 141, 0.62)",
                        borderRadius: 4,
                      },
                      {
                        label: "CAC",
                        data: derived.topBySignups.map((row) => row.cac || 0),
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
          <h2>Ad-Level Funnel Table</h2>
          <span className="muted">Timezone: {metaTimezone}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ad</th>
                <th>Spend</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>Impr / €</th>
                <th>Clicks / €</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>Signups</th>
                <th>Invited</th>
                <th>Viewed Block</th>
                <th>Athlete App</th>
                <th>Paid</th>
                <th>Click to Signup</th>
                <th>Signup to Paid</th>
                <th>Cost / Signup</th>
                <th>CAC</th>
                <th>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan="18">No data for this range.</td>
                </tr>
              ) : (
                tableRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.ad_id}</td>
                    <td>{formatCurrency(row.spend, 2, metaCurrency)}</td>
                    <td>{Math.round(row.impressions).toLocaleString()}</td>
                    <td>{Math.round(row.clicks).toLocaleString()}</td>
                    <td>{formatNumber(row.impressionsPerEuro, 1)}</td>
                    <td>{formatNumber(row.clicksPerEuro, 2)}</td>
                    <td>{formatPercent(row.ctr, 2)}</td>
                    <td>{formatCurrency(row.cpc, 2, metaCurrency)}</td>
                    <td>{row.signups}</td>
                    <td>{row.invited}</td>
                    <td>{row.blocked}</td>
                    <td>{row.athleteShown}</td>
                    <td>{row.paid}</td>
                    <td>{formatPercent(row.clickToSignupRate, 2)}</td>
                    <td>{formatPercent(row.paidRate, 2)}</td>
                    <td>{formatCurrency(row.costPerSignup, 2, metaCurrency)}</td>
                    <td>{formatCurrency(row.cac, 2, metaCurrency)}</td>
                    <td>{formatNumber(row.roas, 2)}</td>
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
            In <code>Ads only</code>, coaches are identified by a populated
            <code>fbclid</code>.
          </li>
        </ul>
      </section>
    </div>
  );
}

// Paste this implementation into your Firebase Functions codebase to replace getMetaInsights.
const axios = require("axios");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "europe-west1";
const ANALYTICS_ADMIN_UID = "B2Xm8CFPyIS2taVlusbcIicWItF3";
const META_GRAPH_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

function parseDateOrThrow(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", `${label} must be YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError("invalid-argument", `${label} is invalid.`);
  }
  return date;
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function rowKeyForLevel(row, level) {
  if (level === "campaign") return String(row.campaign_id || "unknown_campaign");
  if (level === "adset") return String(row.adset_id || "unknown_adset");
  return String(row.ad_id || "unknown_ad");
}

async function getWithRetry(url, params, attempt = 1) {
  try {
    return await axios.get(url, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (error) {
    const status = error?.response?.status;
    const retryable = status === 429 || (status >= 500 && status <= 599);
    if (!retryable || attempt >= MAX_RETRIES) {
      throw error;
    }

    const backoffMs = 500 * 2 ** (attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return getWithRetry(url, params, attempt + 1);
  }
}

function normalizeMetaRow(raw) {
  return {
    ad_id: raw.ad_id ? String(raw.ad_id) : "unknown_ad",
    adset_id: raw.adset_id ? String(raw.adset_id) : "unknown_adset",
    campaign_id: raw.campaign_id ? String(raw.campaign_id) : "unknown_campaign",
    spend: toNumber(raw.spend),
    impressions: toNumber(raw.impressions),
    clicks: toNumber(raw.clicks),
    date_start: raw.date_start,
    date_stop: raw.date_stop,
  };
}

function aggregateRows(rows, level, daily) {
  const totalsByKey = {};
  const dailyByKey = {};

  for (const row of rows) {
    const key = rowKeyForLevel(row, level);

    if (!totalsByKey[key]) {
      totalsByKey[key] = {
        ad_id: row.ad_id,
        adset_id: row.adset_id,
        campaign_id: row.campaign_id,
        spend: 0,
        impressions: 0,
        clicks: 0,
      };
    }

    totalsByKey[key].spend += row.spend;
    totalsByKey[key].impressions += row.impressions;
    totalsByKey[key].clicks += row.clicks;

    if (daily && row.date_start) {
      if (!dailyByKey[key]) {
        dailyByKey[key] = {};
      }
      if (!dailyByKey[key][row.date_start]) {
        dailyByKey[key][row.date_start] = {spend: 0, impressions: 0, clicks: 0};
      }
      dailyByKey[key][row.date_start].spend += row.spend;
      dailyByKey[key][row.date_start].impressions += row.impressions;
      dailyByKey[key][row.date_start].clicks += row.clicks;
    }
  }

  return {totalsByKey, dailyByKey: daily ? dailyByKey : undefined};
}

exports.getMetaInsights = onCall(
    {
      region: REGION,
      secrets: [metaMarketingAccessToken, metaAdAccountId],
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }
      if (request.auth.uid !== ANALYTICS_ADMIN_UID) {
        throw new HttpsError("permission-denied", "Not allowed.");
      }

      const since = request.data?.since;
      const until = request.data?.until;
      const level = ["ad", "adset", "campaign"].includes(request.data?.level)
        ? request.data.level
        : "ad";
      const aggregate = toBool(request.data?.aggregate, false);
      const daily = toBool(request.data?.daily, false);

      const sinceDate = parseDateOrThrow(since, "since");
      const untilDate = parseDateOrThrow(until, "until");
      if (sinceDate.getTime() > untilDate.getTime()) {
        throw new HttpsError("invalid-argument", "since must be <= until.");
      }

      const accessToken = metaMarketingAccessToken.value();
      const adAccountId = metaAdAccountId.value();
      if (!accessToken || !adAccountId) {
        throw new HttpsError(
            "failed-precondition",
            "Missing META_MARKETING_ACCESS_TOKEN or META_AD_ACCOUNT_ID.",
        );
      }

      let url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/insights`;
      let params = {
        access_token: accessToken,
        level: "ad",
        fields: "ad_id,adset_id,campaign_id,spend,impressions,clicks,date_start,date_stop",
        time_range: JSON.stringify({since, until}),
        time_increment: 1,
        limit: 500,
      };

      const rows = [];
      while (url) {
        const response = await getWithRetry(url, params);
        const payload = response.data || {};

        if (Array.isArray(payload.data)) {
          rows.push(...payload.data.map((row) => normalizeMetaRow(row)));
        }

        const nextPage = payload.paging && payload.paging.next ? payload.paging.next : null;
        url = nextPage;
        params = undefined;
      }

      const base = {
        since,
        until,
        timezone: "Europe/Berlin",
        currency: "EUR",
        level,
        aggregate,
        daily,
        count: rows.length,
      };

      if (!aggregate) {
        return {...base, rows};
      }

      const aggregated = aggregateRows(rows, level, daily);
      return {
        ...base,
        totalsByKey: aggregated.totalsByKey,
        dailyByKey: aggregated.dailyByKey,
      };
    },
);

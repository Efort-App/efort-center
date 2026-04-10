// Paste this implementation into your Firebase Functions codebase to replace getMetaInsights.
const axios = require("axios");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "europe-west1";
const ANALYTICS_ADMIN_UID = "B2Xm8CFPyIS2taVlusbcIicWItF3";
const DEFAULT_META_GRAPH_VERSION = "v24.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const MAX_IDS_PER_REQUEST = 50;

function getMetaGraphVersion() {
  const configured = String(process.env.META_GRAPH_VERSION || "").trim();
  if (/^v\d+\.\d+$/.test(configured)) {
    return configured;
  }
  return DEFAULT_META_GRAPH_VERSION;
}

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

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function cleanStringList(values) {
  if (!Array.isArray(values)) return [];
  return values
      .map((value) => cleanString(value))
      .filter(Boolean);
}

function normalizeToken(value) {
  const normalized = cleanString(value);
  return normalized ? normalized.toLowerCase().replace(/[^a-z0-9]+/g, "") : null;
}

function pushUniqueCandidate(target, value) {
  const normalized = normalizeToken(value);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
}

function extractMetricValue(rawMetric, candidateTokens) {
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

function accumulateNullableMetric(bucket, field, value) {
  const numericValue = toNullableNumber(value);
  if (numericValue === null) {
    return;
  }
  bucket[field] = (bucket[field] ?? 0) + numericValue;
}

function buildOptimizationMetricCandidates({optimizationEvent, customConversionId}) {
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

function extractOptimizationMetrics(raw, optimizationEvent, customConversionId) {
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

function extractCreativeFinalUrl(creative) {
  if (!creative || typeof creative !== "object") return null;
  if (cleanString(creative.object_url)) return cleanString(creative.object_url);
  if (cleanString(creative.link_url)) return cleanString(creative.link_url);

  const storySpec =
    creative.object_story_spec && typeof creative.object_story_spec === "object"
      ? creative.object_story_spec
      : null;
  const linkData =
    storySpec?.link_data && typeof storySpec.link_data === "object"
      ? storySpec.link_data
      : null;
  if (cleanString(linkData?.link)) return cleanString(linkData.link);

  const videoData =
    storySpec?.video_data && typeof storySpec.video_data === "object"
      ? storySpec.video_data
      : null;
  const callToActionValue =
    videoData?.call_to_action?.value && typeof videoData.call_to_action.value === "object"
      ? videoData.call_to_action.value
      : null;
  return cleanString(callToActionValue?.link);
}

function pushUniqueString(target, value) {
  const normalized = cleanString(value);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
}

function firstAssetFeedUrl(entries) {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const url = cleanString(entry.url);
    if (url) return url;
  }
  return null;
}

function extractCreativeImageHashes(creative) {
  if (!creative || typeof creative !== "object") return [];
  const hashes = [];
  pushUniqueString(hashes, creative.image_hash);

  const storySpec =
    creative.object_story_spec && typeof creative.object_story_spec === "object"
      ? creative.object_story_spec
      : null;
  const photoData =
    storySpec?.photo_data && typeof storySpec.photo_data === "object"
      ? storySpec.photo_data
      : null;
  pushUniqueString(hashes, photoData?.image_hash);

  const videoData =
    storySpec?.video_data && typeof storySpec.video_data === "object"
      ? storySpec.video_data
      : null;
  pushUniqueString(hashes, videoData?.image_hash);

  const linkData =
    storySpec?.link_data && typeof storySpec.link_data === "object"
      ? storySpec.link_data
      : null;
  pushUniqueString(hashes, linkData?.image_hash);

  const templateData =
    storySpec?.template_data && typeof storySpec.template_data === "object"
      ? storySpec.template_data
      : null;
  pushUniqueString(hashes, templateData?.image_hash);

  const assetFeedSpec =
    creative.asset_feed_spec && typeof creative.asset_feed_spec === "object"
      ? creative.asset_feed_spec
      : null;
  if (Array.isArray(assetFeedSpec?.images)) {
    for (const image of assetFeedSpec.images) {
      pushUniqueString(hashes, image?.hash);
    }
  }

  return hashes;
}

function extractCreativeAssetUrl(creative, adImagesByHash = {}) {
  if (!creative || typeof creative !== "object") return null;

  const creativeImageHashes = extractCreativeImageHashes(creative);
  for (const hash of creativeImageHashes) {
    const adImage = adImagesByHash[hash];
    const resolvedUrl = cleanString(adImage?.url);
    if (resolvedUrl) return resolvedUrl;
  }

  if (cleanString(creative.image_url)) return cleanString(creative.image_url);

  const storySpec =
    creative.object_story_spec && typeof creative.object_story_spec === "object"
      ? creative.object_story_spec
      : null;
  const photoData =
    storySpec?.photo_data && typeof storySpec.photo_data === "object"
      ? storySpec.photo_data
      : null;
  if (cleanString(photoData?.url)) return cleanString(photoData.url);

  const videoData =
    storySpec?.video_data && typeof storySpec.video_data === "object"
      ? storySpec.video_data
      : null;
  if (cleanString(videoData?.image_url)) return cleanString(videoData.image_url);

  const linkData =
    storySpec?.link_data && typeof storySpec.link_data === "object"
      ? storySpec.link_data
      : null;
  if (cleanString(linkData?.picture)) return cleanString(linkData.picture);

  const templateData =
    storySpec?.template_data && typeof storySpec.template_data === "object"
      ? storySpec.template_data
      : null;
  if (cleanString(templateData?.picture)) return cleanString(templateData.picture);

  const assetFeedSpec =
    creative.asset_feed_spec && typeof creative.asset_feed_spec === "object"
      ? creative.asset_feed_spec
      : null;
  if (firstAssetFeedUrl(assetFeedSpec?.images)) return firstAssetFeedUrl(assetFeedSpec.images);

  return cleanString(creative.thumbnail_url);
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstAssetFeedText(entries) {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const text = cleanString(entry.text);
    if (text) return text;
  }
  return null;
}

function extractCreativeCopy(creative) {
  if (!creative || typeof creative !== "object") {
    return {
      primary_text: null,
      headline: null,
      description: null,
      cta_text: null,
    };
  }

  const storySpec =
    creative.object_story_spec && typeof creative.object_story_spec === "object"
      ? creative.object_story_spec
      : null;
  const linkData =
    storySpec?.link_data && typeof storySpec.link_data === "object"
      ? storySpec.link_data
      : null;
  const videoData =
    storySpec?.video_data && typeof storySpec.video_data === "object"
      ? storySpec.video_data
      : null;
  const templateData =
    storySpec?.template_data && typeof storySpec.template_data === "object"
      ? storySpec.template_data
      : null;
  const assetFeedSpec =
    creative.asset_feed_spec && typeof creative.asset_feed_spec === "object"
      ? creative.asset_feed_spec
      : null;

  return {
    primary_text: pickFirstString(
        creative.body,
        linkData?.message,
        videoData?.message,
        templateData?.message,
        firstAssetFeedText(assetFeedSpec?.bodies),
    ),
    headline: pickFirstString(
        creative.title,
        linkData?.name,
        videoData?.title,
        templateData?.name,
        firstAssetFeedText(assetFeedSpec?.titles),
    ),
    description: pickFirstString(
        linkData?.description,
        videoData?.link_description,
        templateData?.description,
        firstAssetFeedText(assetFeedSpec?.descriptions),
    ),
    cta_text: pickFirstString(
        creative.call_to_action_type,
        linkData?.call_to_action?.type,
        videoData?.call_to_action?.type,
        templateData?.call_to_action?.type,
        Array.isArray(assetFeedSpec?.call_to_action_types) ? assetFeedSpec.call_to_action_types[0] : null,
    ),
  };
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function collectUniqueIds(rows, field) {
  return Array.from(
      new Set(
          rows
              .map((row) => cleanString(row?.[field]))
              .filter((value) => value && !value.startsWith("unknown")),
      ),
  );
}

function rowKeyForLevel(row, level) {
  if (level === "campaign") return String(row.campaign_id || "unknown_campaign");
  if (level === "adset") return String(row.adset_id || "unknown_adset");
  return String(row.ad_id || "unknown_ad");
}

function normalizeAdAccountId(value) {
  const raw = String(value || "").trim();
  if (/^act_\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `act_${raw}`;
  return raw;
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
  const creative = raw.creative && typeof raw.creative === "object" ? raw.creative : null;
  const targeting = raw.targeting && typeof raw.targeting === "object" ? raw.targeting : null;
  const geoLocations =
    targeting?.geo_locations && typeof targeting.geo_locations === "object"
      ? targeting.geo_locations
      : null;
  const optimizationMetrics = extractOptimizationMetrics(
      raw,
      raw.optimization_event,
      raw.custom_conversion_id,
  );
  const finalUrl = extractCreativeFinalUrl(creative) || cleanString(raw.final_url);
  const creativeAssetUrl =
    cleanString(raw.creative_asset_url) || extractCreativeAssetUrl(creative);
  const creativeCopy = extractCreativeCopy(creative);
  return {
    ad_id: raw.ad_id ? String(raw.ad_id) : "unknown_ad",
    adset_id: raw.adset_id ? String(raw.adset_id) : "unknown_adset",
    campaign_id: raw.campaign_id ? String(raw.campaign_id) : "unknown_campaign",
    ad_name: cleanString(raw.ad_name),
    ad_status: cleanString(raw.ad_status),
    ad_effective_status: cleanString(raw.ad_effective_status),
    primary_text: cleanString(raw.primary_text || creativeCopy.primary_text),
    headline: cleanString(raw.headline || creativeCopy.headline),
    description: cleanString(raw.description || creativeCopy.description),
    cta_text: cleanString(raw.cta_text || creativeCopy.cta_text),
    creative_id: cleanString(raw.creative_id || creative?.id),
    creative_name: cleanString(raw.creative_name || creative?.name),
    creative_asset_url: creativeAssetUrl,
    creative_thumbnail_url: cleanString(raw.creative_thumbnail_url || creative?.thumbnail_url),
    final_url: finalUrl,
    url_tags: cleanString(raw.url_tags || creative?.url_tags),
    post_id: cleanString(
        raw.post_id ||
        creative?.effective_object_story_id ||
        creative?.object_story_id,
    ),
    post_permalink: cleanString(raw.post_permalink),
    adset_name: cleanString(raw.adset_name),
    adset_status: cleanString(raw.adset_status),
    adset_effective_status: cleanString(raw.adset_effective_status),
    optimization_goal: cleanString(raw.optimization_goal),
    optimization_event: cleanString(raw.optimization_event),
    billing_event: cleanString(raw.billing_event),
    bid_strategy: cleanString(raw.bid_strategy),
    bid_amount: toNumber(raw.bid_amount),
    daily_budget: toNumber(raw.daily_budget),
    lifetime_budget: toNumber(raw.lifetime_budget),
    attribution_spec: Array.isArray(raw.attribution_spec) ? raw.attribution_spec : [],
    publisher_platforms: cleanStringList(targeting?.publisher_platforms),
    facebook_positions: cleanStringList(targeting?.facebook_positions),
    instagram_positions: cleanStringList(targeting?.instagram_positions),
    device_platforms: cleanStringList(targeting?.device_platforms),
    countries: cleanStringList(geoLocations?.countries),
    start_time: cleanString(raw.start_time),
    end_time: cleanString(raw.end_time),
    campaign_name: cleanString(raw.campaign_name),
    campaign_objective: cleanString(raw.campaign_objective),
    campaign_status: cleanString(raw.campaign_status),
    campaign_effective_status: cleanString(raw.campaign_effective_status),
    campaign_buying_type: cleanString(raw.campaign_buying_type),
    spend: toNumber(raw.spend),
    impressions: toNumber(raw.impressions),
    reach: toNullableNumber(raw.reach),
    clicks: toNumber(raw.clicks),
    outbound_clicks: toNullableNumber(raw.outbound_clicks) ??
      extractMetricValue(raw.outbound_clicks, [normalizeToken("outbound_click")]) ??
      extractMetricValue(raw.actions, [normalizeToken("outbound_click")]),
    unique_outbound_clicks: toNullableNumber(raw.unique_outbound_clicks) ??
      extractMetricValue(raw.unique_outbound_clicks, [normalizeToken("outbound_click")]),
    frequency: toNullableNumber(raw.frequency),
    cpm: toNullableNumber(raw.cpm),
    result_count: optimizationMetrics.result_count,
    cost_per_result: optimizationMetrics.cost_per_result,
    date_start: raw.date_start,
    date_stop: raw.date_stop,
  };
}

async function fetchGraphObjectsByIds({accessToken, graphVersion, ids, fields}) {
  const byId = {};
  if (!ids.length) return byId;

  const url = `https://graph.facebook.com/${graphVersion}/`;
  for (const chunk of chunkValues(ids, MAX_IDS_PER_REQUEST)) {
    const response = await getWithRetry(url, {
      access_token: accessToken,
      ids: chunk.join(","),
      fields,
    });

    const payload = response.data || {};
    for (const [id, value] of Object.entries(payload)) {
      if (value && typeof value === "object" && !value.error) {
        byId[id] = value;
      }
    }
  }

  return byId;
}

async function fetchAdImagesByHashes({accessToken, graphVersion, adAccountId, hashes}) {
  const byHash = {};
  if (!hashes.length) return byHash;

  const url = `https://graph.facebook.com/${graphVersion}/${adAccountId}/adimages`;
  for (const chunk of chunkValues(hashes, MAX_IDS_PER_REQUEST)) {
    const response = await getWithRetry(url, {
      access_token: accessToken,
      hashes: JSON.stringify(chunk),
      fields: "hash,url,original_width,original_height,url_128",
    });

    const payload = response.data || {};
    const entries = Array.isArray(payload.data) ? payload.data : [];
    for (const entry of entries) {
      const hash = cleanString(entry?.hash);
      if (!hash) continue;
      byHash[hash] = entry;
    }
  }

  return byHash;
}

async function enrichRows(rows, {accessToken, graphVersion, adAccountId}) {
  if (!rows.length) return rows;

  const adDetailsById = await fetchGraphObjectsByIds({
    accessToken,
    graphVersion,
    ids: collectUniqueIds(rows, "ad_id"),
    fields: "id,name,status,effective_status,preview_shareable_link,adset_id,campaign_id,creative{id,name,image_hash,image_url,thumbnail_url,object_url,link_url,url_tags,object_story_id,effective_object_story_id,object_story_spec,asset_feed_spec,body,title,call_to_action_type}",
  });

  const adsetDetailsById = await fetchGraphObjectsByIds({
    accessToken,
    graphVersion,
    ids: collectUniqueIds(rows, "adset_id"),
    fields: "id,name,status,effective_status,start_time,end_time,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,attribution_spec,promoted_object,targeting,campaign_id",
  });

  const campaignDetailsById = await fetchGraphObjectsByIds({
    accessToken,
    graphVersion,
    ids: collectUniqueIds(rows, "campaign_id"),
    fields: "id,name,objective,status,effective_status,buying_type",
  });

  const customConversionIds = Array.from(
      new Set(
          Object.values(adsetDetailsById)
              .map((adset) => cleanString(adset?.promoted_object?.custom_conversion_id))
              .filter(Boolean),
      ),
  );

  const customConversionById = await fetchGraphObjectsByIds({
    accessToken,
    graphVersion,
    ids: customConversionIds,
    fields: "id,name",
  });

  const creativeImageHashes = Array.from(
      new Set(
          Object.values(adDetailsById)
              .flatMap((ad) => extractCreativeImageHashes(ad?.creative))
              .filter(Boolean),
      ),
  );
  const adImagesByHash = await fetchAdImagesByHashes({
    accessToken,
    graphVersion,
    adAccountId,
    hashes: creativeImageHashes,
  });

  return rows.map((row) => {
    const adDetails = adDetailsById[row.ad_id] || {};
    const adsetDetails = adsetDetailsById[row.adset_id] || {};
    const campaignDetails = campaignDetailsById[row.campaign_id] || {};
    const promotedObject =
      adsetDetails.promoted_object && typeof adsetDetails.promoted_object === "object"
        ? adsetDetails.promoted_object
        : null;
    const customConversionId = cleanString(promotedObject?.custom_conversion_id);
    const customConversion = customConversionId
      ? customConversionById[customConversionId] || {}
      : {};
    const resolvedOptimizationEvent =
      cleanString(customConversion.name) ||
      cleanString(promotedObject?.custom_event_type) ||
      cleanString(adsetDetails.optimization_goal);
    const creativeAssetUrl = extractCreativeAssetUrl(adDetails.creative, adImagesByHash);

    return normalizeMetaRow({
      ...row,
      ad_name: adDetails.name,
      ad_status: adDetails.status,
      ad_effective_status: adDetails.effective_status,
      creative: adDetails.creative,
      creative_asset_url: creativeAssetUrl,
      post_permalink: adDetails.preview_shareable_link,
      adset_name: adsetDetails.name,
      adset_status: adsetDetails.status,
      adset_effective_status: adsetDetails.effective_status,
      optimization_goal: adsetDetails.optimization_goal,
      optimization_event: resolvedOptimizationEvent,
      custom_conversion_id: customConversionId,
      billing_event: adsetDetails.billing_event,
      bid_strategy: adsetDetails.bid_strategy,
      bid_amount: adsetDetails.bid_amount,
      daily_budget: adsetDetails.daily_budget,
      lifetime_budget: adsetDetails.lifetime_budget,
      attribution_spec: adsetDetails.attribution_spec,
      targeting: adsetDetails.targeting,
      start_time: adsetDetails.start_time,
      end_time: adsetDetails.end_time,
      campaign_name: campaignDetails.name,
      campaign_objective: campaignDetails.objective,
      campaign_status: campaignDetails.status,
      campaign_effective_status: campaignDetails.effective_status,
      campaign_buying_type: campaignDetails.buying_type,
    });
  });
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
        ad_name: row.ad_name || null,
        ad_status: row.ad_status || null,
        ad_effective_status: row.ad_effective_status || null,
        primary_text: row.primary_text || null,
        headline: row.headline || null,
        description: row.description || null,
        cta_text: row.cta_text || null,
        creative_id: row.creative_id || null,
        creative_name: row.creative_name || null,
        creative_asset_url: row.creative_asset_url || null,
        creative_thumbnail_url: row.creative_thumbnail_url || null,
        final_url: row.final_url || null,
        url_tags: row.url_tags || null,
        post_id: row.post_id || null,
        post_permalink: row.post_permalink || null,
        adset_name: row.adset_name || null,
        adset_status: row.adset_status || null,
        adset_effective_status: row.adset_effective_status || null,
        optimization_goal: row.optimization_goal || null,
        optimization_event: row.optimization_event || null,
        billing_event: row.billing_event || null,
        bid_strategy: row.bid_strategy || null,
        bid_amount: row.bid_amount || 0,
        daily_budget: row.daily_budget || 0,
        lifetime_budget: row.lifetime_budget || 0,
        attribution_spec: row.attribution_spec || [],
        publisher_platforms: row.publisher_platforms || [],
        facebook_positions: row.facebook_positions || [],
        instagram_positions: row.instagram_positions || [],
        device_platforms: row.device_platforms || [],
        countries: row.countries || [],
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        campaign_name: row.campaign_name || null,
        campaign_objective: row.campaign_objective || null,
        campaign_status: row.campaign_status || null,
        campaign_effective_status: row.campaign_effective_status || null,
        campaign_buying_type: row.campaign_buying_type || null,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        outbound_clicks: 0,
        unique_outbound_clicks: 0,
        frequency: row.frequency || null,
        cpm: row.cpm || null,
        result_count: null,
        cost_per_result: row.cost_per_result || null,
      };
    }

    totalsByKey[key].ad_name = totalsByKey[key].ad_name || row.ad_name || null;
    totalsByKey[key].ad_status = totalsByKey[key].ad_status || row.ad_status || null;
    totalsByKey[key].ad_effective_status =
      totalsByKey[key].ad_effective_status || row.ad_effective_status || null;
    totalsByKey[key].primary_text = totalsByKey[key].primary_text || row.primary_text || null;
    totalsByKey[key].headline = totalsByKey[key].headline || row.headline || null;
    totalsByKey[key].description = totalsByKey[key].description || row.description || null;
    totalsByKey[key].cta_text = totalsByKey[key].cta_text || row.cta_text || null;
    totalsByKey[key].creative_id = totalsByKey[key].creative_id || row.creative_id || null;
    totalsByKey[key].creative_name = totalsByKey[key].creative_name || row.creative_name || null;
    totalsByKey[key].creative_asset_url =
      totalsByKey[key].creative_asset_url || row.creative_asset_url || null;
    totalsByKey[key].creative_thumbnail_url =
      totalsByKey[key].creative_thumbnail_url || row.creative_thumbnail_url || null;
    totalsByKey[key].final_url = totalsByKey[key].final_url || row.final_url || null;
    totalsByKey[key].url_tags = totalsByKey[key].url_tags || row.url_tags || null;
    totalsByKey[key].post_id = totalsByKey[key].post_id || row.post_id || null;
    totalsByKey[key].post_permalink =
      totalsByKey[key].post_permalink || row.post_permalink || null;
    totalsByKey[key].adset_name = totalsByKey[key].adset_name || row.adset_name || null;
    totalsByKey[key].adset_status = totalsByKey[key].adset_status || row.adset_status || null;
    totalsByKey[key].adset_effective_status =
      totalsByKey[key].adset_effective_status || row.adset_effective_status || null;
    totalsByKey[key].optimization_goal =
      totalsByKey[key].optimization_goal || row.optimization_goal || null;
    totalsByKey[key].optimization_event =
      totalsByKey[key].optimization_event || row.optimization_event || null;
    totalsByKey[key].billing_event = totalsByKey[key].billing_event || row.billing_event || null;
    totalsByKey[key].bid_strategy = totalsByKey[key].bid_strategy || row.bid_strategy || null;
    totalsByKey[key].bid_amount = totalsByKey[key].bid_amount || row.bid_amount || 0;
    totalsByKey[key].daily_budget = totalsByKey[key].daily_budget || row.daily_budget || 0;
    totalsByKey[key].lifetime_budget =
      totalsByKey[key].lifetime_budget || row.lifetime_budget || 0;
    totalsByKey[key].attribution_spec =
      totalsByKey[key].attribution_spec.length > 0 ? totalsByKey[key].attribution_spec : row.attribution_spec || [];
    totalsByKey[key].publisher_platforms =
      totalsByKey[key].publisher_platforms.length > 0 ?
        totalsByKey[key].publisher_platforms :
        row.publisher_platforms || [];
    totalsByKey[key].facebook_positions =
      totalsByKey[key].facebook_positions.length > 0 ?
        totalsByKey[key].facebook_positions :
        row.facebook_positions || [];
    totalsByKey[key].instagram_positions =
      totalsByKey[key].instagram_positions.length > 0 ?
        totalsByKey[key].instagram_positions :
        row.instagram_positions || [];
    totalsByKey[key].device_platforms =
      totalsByKey[key].device_platforms.length > 0 ?
        totalsByKey[key].device_platforms :
        row.device_platforms || [];
    totalsByKey[key].countries =
      totalsByKey[key].countries.length > 0 ? totalsByKey[key].countries : row.countries || [];
    totalsByKey[key].start_time = totalsByKey[key].start_time || row.start_time || null;
    totalsByKey[key].end_time = totalsByKey[key].end_time || row.end_time || null;
    totalsByKey[key].campaign_name = totalsByKey[key].campaign_name || row.campaign_name || null;
    totalsByKey[key].campaign_objective =
      totalsByKey[key].campaign_objective || row.campaign_objective || null;
    totalsByKey[key].campaign_status =
      totalsByKey[key].campaign_status || row.campaign_status || null;
    totalsByKey[key].campaign_effective_status =
      totalsByKey[key].campaign_effective_status || row.campaign_effective_status || null;
    totalsByKey[key].campaign_buying_type =
      totalsByKey[key].campaign_buying_type || row.campaign_buying_type || null;
    totalsByKey[key].spend += row.spend;
    totalsByKey[key].impressions += row.impressions;
    totalsByKey[key].reach += toNumber(row.reach);
    totalsByKey[key].clicks += row.clicks;
    totalsByKey[key].outbound_clicks += toNumber(row.outbound_clicks);
    totalsByKey[key].unique_outbound_clicks += toNumber(row.unique_outbound_clicks);
    accumulateNullableMetric(totalsByKey[key], "result_count", row.result_count);
    if (totalsByKey[key].impressions > 0) {
      totalsByKey[key].cpm = (totalsByKey[key].spend * 1000) / totalsByKey[key].impressions;
    }
    if (totalsByKey[key].reach > 0) {
      totalsByKey[key].frequency = totalsByKey[key].impressions / totalsByKey[key].reach;
    }
    if (totalsByKey[key].result_count !== null && totalsByKey[key].result_count > 0) {
      totalsByKey[key].cost_per_result = totalsByKey[key].spend / totalsByKey[key].result_count;
    }

    if (daily && row.date_start) {
      if (!dailyByKey[key]) {
        dailyByKey[key] = {};
      }
      if (!dailyByKey[key][row.date_start]) {
        dailyByKey[key][row.date_start] = {
          spend: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          outbound_clicks: 0,
          unique_outbound_clicks: 0,
          result_count: null,
          frequency: null,
          cpm: null,
          cost_per_result: null,
        };
      }
      dailyByKey[key][row.date_start].spend += row.spend;
      dailyByKey[key][row.date_start].impressions += row.impressions;
      dailyByKey[key][row.date_start].reach += toNumber(row.reach);
      dailyByKey[key][row.date_start].clicks += row.clicks;
      dailyByKey[key][row.date_start].outbound_clicks += toNumber(row.outbound_clicks);
      dailyByKey[key][row.date_start].unique_outbound_clicks += toNumber(row.unique_outbound_clicks);
      accumulateNullableMetric(dailyByKey[key][row.date_start], "result_count", row.result_count);
      if (dailyByKey[key][row.date_start].impressions > 0) {
        dailyByKey[key][row.date_start].cpm =
          (dailyByKey[key][row.date_start].spend * 1000) /
          dailyByKey[key][row.date_start].impressions;
      }
      if (dailyByKey[key][row.date_start].reach > 0) {
        dailyByKey[key][row.date_start].frequency =
          dailyByKey[key][row.date_start].impressions /
          dailyByKey[key][row.date_start].reach;
      }
      if (
        dailyByKey[key][row.date_start].result_count !== null &&
        dailyByKey[key][row.date_start].result_count > 0
      ) {
        dailyByKey[key][row.date_start].cost_per_result =
          dailyByKey[key][row.date_start].spend /
          dailyByKey[key][row.date_start].result_count;
      }
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
      const graphVersion = getMetaGraphVersion();
      const normalizedAdAccountId = normalizeAdAccountId(adAccountId);

      let url = `https://graph.facebook.com/${graphVersion}/${normalizedAdAccountId}/insights`;
      let params = {
        access_token: accessToken,
        level: "ad",
        fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,outbound_clicks,unique_outbound_clicks,frequency,cpm,actions,conversions,cost_per_action_type,cost_per_conversion,date_start,date_stop",
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

      const enrichedRows = await enrichRows(rows, {
        accessToken,
        graphVersion,
        adAccountId: normalizedAdAccountId,
      });

      const base = {
        since,
        until,
        timezone: "Europe/Berlin",
        currency: "EUR",
        level,
        aggregate,
        daily,
        count: enrichedRows.length,
      };

      if (!aggregate) {
        return {...base, rows: enrichedRows};
      }

      const aggregated = aggregateRows(enrichedRows, level, daily);
      return {
        ...base,
        totalsByKey: aggregated.totalsByKey,
        dailyByKey: aggregated.dailyByKey,
      };
    },
);

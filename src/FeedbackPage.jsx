import {useEffect, useState} from "react";
import {collection, getDocs, limit, orderBy, query, startAfter} from "firebase/firestore";
import {db, firebaseInitError} from "./firebase";
import {
  formatFeedbackTimestamp,
  formatFeedbackTimestampCsv,
  normalizeFeedbackEntries,
} from "./feedback";
import {buildCsvContent} from "./tableExport";

const FEEDBACK_COLLECTION = "feedback";
const FEEDBACK_PAGE_SIZE = 5;

export default function FeedbackPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [lastVisibleDoc, setLastVisibleDoc] = useState(null);

  const loadFeedback = async () => {
    setLoading(true);
    setError("");

    try {
      if (!db) {
        throw new Error(firebaseInitError || "Firebase Firestore is not initialized.");
      }

      const feedbackQuery = query(
        collection(db, FEEDBACK_COLLECTION),
        orderBy("timestamp", "desc"),
        limit(FEEDBACK_PAGE_SIZE + 1),
      );
      const snapshot = await getDocs(feedbackQuery);
      const visibleDocs = snapshot.docs.slice(0, FEEDBACK_PAGE_SIZE);
      const records = visibleDocs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setEntries(normalizeFeedbackEntries(records));
      setHasMore(snapshot.docs.length > FEEDBACK_PAGE_SIZE);
      setLastVisibleDoc(visibleDocs.at(-1) || null);
    } catch (err) {
      setEntries([]);
      setHasMore(false);
      setLastVisibleDoc(null);
      setError(err?.message || "Failed to load feedback.");
    } finally {
      setLoading(false);
    }
  };

  const loadMoreFeedback = async () => {
    if (!db || !lastVisibleDoc || loadingMore) return;

    setLoadingMore(true);
    setError("");

    try {
      const feedbackQuery = query(
        collection(db, FEEDBACK_COLLECTION),
        orderBy("timestamp", "desc"),
        startAfter(lastVisibleDoc),
        limit(FEEDBACK_PAGE_SIZE + 1),
      );
      const snapshot = await getDocs(feedbackQuery);
      const visibleDocs = snapshot.docs.slice(0, FEEDBACK_PAGE_SIZE);
      const records = visibleDocs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setEntries((current) => [...current, ...normalizeFeedbackEntries(records)]);
      setHasMore(snapshot.docs.length > FEEDBACK_PAGE_SIZE);
      setLastVisibleDoc(visibleDocs.at(-1) || lastVisibleDoc);
    } catch (err) {
      setError(err?.message || "Failed to load more feedback.");
    } finally {
      setLoadingMore(false);
    }
  };

  const buildFeedbackCsv = (rows) => buildCsvContent(
    [
      {label: "source", csvValue: (row) => row.source || ""},
      {label: "text", csvValue: (row) => row.text || ""},
      {label: "coach_id", csvValue: (row) => row.coach_id || ""},
      {label: "timestamp", csvValue: (row) => formatFeedbackTimestampCsv(row.timestampMs)},
    ],
    rows,
  );

  const copyTextToClipboard = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleCopyAll = async () => {
    if (!db || copying) return;

    setCopying(true);
    setError("");
    setCopyStatus("");

    try {
      const feedbackQuery = query(
        collection(db, FEEDBACK_COLLECTION),
        orderBy("timestamp", "desc"),
      );
      const snapshot = await getDocs(feedbackQuery);
      const records = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      const normalized = normalizeFeedbackEntries(records);
      const csvContent = buildFeedbackCsv(normalized);

      await copyTextToClipboard(csvContent);
      setCopyStatus(`Copied ${normalized.length} ${normalized.length === 1 ? "row" : "rows"}.`);
    } catch (err) {
      setError(err?.message || "Failed to copy feedback CSV.");
    } finally {
      setCopying(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, []);

  return (
    <div className="feedback-page">
      <section className="card tasks-hero">
        <div className="feedback-header">
          <div className="feedback-header-copy">
            <div className="eyebrow">Customer input</div>
            <h2>Feedback</h2>
            <p className="feedback-subtitle">
              Latest entries from the Firebase <code>feedback</code> collection, sorted by timestamp.
            </p>
          </div>
          <div className="tasks-hero-meta">
            <button
              className="secondary"
              type="button"
              onClick={handleCopyAll}
              disabled={loading || loadingMore || copying}
            >
              {copying ? "Copying…" : "Copy all"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="card status-card">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {copyStatus ? (
        <section className="card note-card">
          <p>{copyStatus}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="card feedback-empty">
          <p>Loading feedback…</p>
        </section>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <section className="card feedback-empty">
          <p>No feedback found.</p>
        </section>
      ) : null}

      {!loading && entries.length > 0 ? (
        <>
          <section className="feedback-list" aria-label="Feedback entries">
            {entries.map((entry) => (
              <article key={entry.id} className="feedback-item">
                <div className="feedback-item-meta">
                  <span className="feedback-item-date">
                    {formatFeedbackTimestamp(entry.timestampMs)}
                  </span>
                  {entry.coach_id ? (
                    <span className="feedback-item-coach-id">{entry.coach_id}</span>
                  ) : null}
                </div>
                <p className="feedback-item-text">{entry.displayText}</p>
              </article>
            ))}
          </section>

          {hasMore ? (
            <div className="feedback-load-more">
              <button
                className="secondary feedback-load-more-button"
                type="button"
                onClick={loadMoreFeedback}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

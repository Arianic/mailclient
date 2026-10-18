import { useEffect, useState } from "react";
import {
  outlookApi,
  type SearchDiagnostics,
  type IndexStatus,
} from "./outlook";
import { searchConditions } from "./search-structure";
export function SearchRecovery({
  query,
  status,
  onQuery,
}: {
  query: string;
  status: IndexStatus | null;
  onQuery: (query: string) => void;
}) {
  const [result, setResult] = useState<{
    query: string;
    data: SearchDiagnostics;
  } | null>(null);
  const [error, setError] = useState("");
  const [cacheRevision, setCacheRevision] = useState(0);
  useEffect(() => {
    const clear = () => {
      setResult(null);
      setCacheRevision((n) => n + 1);
    };
    window.addEventListener("outlook-cache-cleared", clear);
    return () => window.removeEventListener("outlook-cache-cleared", clear);
  }, []);
  const conditions = searchConditions(query).slice(0, 8);
  useEffect(() => {
    let live = true;
    setResult(null);
    setError("");
    const timer = setTimeout(() => {
      const alternatives = [
        ...new Set(
          searchConditions(query)
            .slice(0, 8)
            .map((p) => p.query),
        ),
      ];
      void outlookApi
        .searchDiagnostics(query, alternatives)
        .then((data) => {
          if (live) setResult({ query, data });
        })
        .catch(() => {
          if (live)
            setError(
              "Search suggestions are unavailable. Your original search is unchanged.",
            );
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    query,
    status?.messages,
    status?.lastSync,
    status?.missingFiles,
    cacheRevision,
  ]);
  const data = result?.query === query ? result.data : null;
  return (
    <div className="search-recovery" aria-label="Search suggestions">
      {!data && !error && (
        <p role="status">Checking alternatives in saved mail…</p>
      )}
      {error && <p role="status">{error}</p>}
      {data?.corrections.length ? (
        <div>
          <p>
            Possible spelling corrections — all other conditions stay in place:
          </p>
          {data.corrections.map((option) => (
            <button
              className="search-recovery-option"
              key={option.query}
              onClick={() => onQuery(option.query)}
            >
              <span>{option.query}</span>
              <span>{option.count.toLocaleString()} matches</span>
            </button>
          ))}
        </div>
      ) : null}
      {data?.alternatives.some((a) => a.count > 0) && (
        <div>
          <p>These changes find matches in saved mail:</p>
          {data.alternatives
            .filter((a) => a.count > 0)
            .map((option) => (
              <button
                className="search-recovery-option"
                key={option.query}
                onClick={() => onQuery(option.query)}
              >
                <span>
                  Remove{" "}
                  {conditions.find((p) => p.query === option.query)?.label ||
                    "one condition"}
                </span>
                <span>{option.count.toLocaleString()} matches</span>
              </button>
            ))}
        </div>
      )}
      {data &&
        !data.corrections.length &&
        !data.alternatives.some((a) => a.count > 0) && (
          <p>No single condition change found matches in saved mail.</p>
        )}
      {status?.paused ||
      status?.pending ||
      status?.coverageGaps ||
      status?.error ||
      !status?.folders ? (
        <p>
          These counts cover saved mail only. Mailbox indexing is incomplete or
          paused.
        </p>
      ) : null}
    </div>
  );
}

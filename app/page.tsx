"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  id: string;
  title: string;
  url: string;
  last_edited_time: string;
};

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function runSearch() {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);

      try {
        const res = await fetch(
          `/api/search?query=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );

        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
        }
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(runSearch, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: 12 }}>
        Notion Graph
      </h1>

      <p style={{ marginBottom: 20, color: "#666" }}>
        Search for a Notion page, then click it to open its graph.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Notion pages..."
        style={{
          width: "100%",
          padding: "12px 14px",
          fontSize: "1rem",
          borderRadius: 10,
          border: "1px solid #ccc",
          outline: "none",
          marginBottom: 16,
        }}
      />

      {loading && <p>Searching...</p>}

      {!loading && query.trim() && results.length === 0 && (
        <p>No pages found.</p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {results.map((page) => (
          <button
            key={page.id}
            onClick={() => router.push(`/graph/${page.id}`)}
            style={{
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              background: "white",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{page.title}</div>
            <div style={{ fontSize: "0.9rem", color: "#666" }}>
              {page.id}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
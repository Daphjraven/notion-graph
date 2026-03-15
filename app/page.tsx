"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function extractPageId(input: string) {
  const cleaned = input.trim();

  // Try dashed UUID first
  const dashedMatches = cleaned.match(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi
  );
  if (dashedMatches && dashedMatches.length > 0) {
    return dashedMatches[dashedMatches.length - 1].replace(/-/g, "");
  }

  // Then look for 32-char hex blocks and take the LAST one
  const hexMatches = cleaned.match(/[a-f0-9]{32}/gi);
  if (hexMatches && hexMatches.length > 0) {
    return hexMatches[hexMatches.length - 1];
  }

  return null;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const pageId = extractPageId(url);

    if (!pageId) {
      setError("Could not find a Notion page ID in that URL.");
      return;
    }

    router.push(`/graph/${pageId}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b1020",
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "720px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <h1 style={{ fontSize: "32px", fontWeight: 700, margin: 0 }}>
          Notion Graph Viewer
        </h1>

        <p style={{ margin: 0, color: "#cbd5e1" }}>
          Paste any Notion page URL to generate its graph.
        </p>

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Notion page URL here..."
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            border: "1px solid #334155",
            background: "#111827",
            color: "white",
            fontSize: "16px",
            outline: "none",
          }}
        />

        <button
          type="submit"
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            border: "none",
            background: "#38bdf8",
            color: "#0b1020",
            fontSize: "16px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Generate Graph
        </button>

        {error ? (
          <p style={{ color: "#fda4af", margin: 0 }}>{error}</p>
        ) : null}
      </form>
    </main>
  );
}
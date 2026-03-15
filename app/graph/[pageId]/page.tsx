"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function GraphPage() {
  const params = useParams();
  const pageId = params.pageId as string;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!pageId) return;

    fetch(`/api/graph/${pageId}`)
      .then((res) => res.json())
      .then(setData)
      .catch(console.error);
  }, [pageId]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: "0 16px" }}>
      <h1>Graph for page</h1>
      <p>{pageId}</p>

      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
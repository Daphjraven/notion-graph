"use client";

import { useParams } from "next/navigation";
import NotionGraphView from "@/app/components/NotionGraphView";

export default function GraphPage() {
  const params = useParams();
  const pageId = params.pageId as string;

  return <NotionGraphView pageId={pageId} />;
}
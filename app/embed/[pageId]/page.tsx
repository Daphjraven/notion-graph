import GraphCanvas from "@/components/GraphCanvas";

export default async function EmbedGraphPage({ params }: any) {
  const { pageId } = await params;
  return <GraphCanvas pageId={pageId} embedMode={true} />;
}
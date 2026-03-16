import GraphCanvas from "../../components/GraphCanvas";

export default function EmbedGraphPage({
  params,
}: {
  params: { pageId: string };
}) {
  const { pageId } = params;

  return <GraphCanvas pageId={pageId} embedMode={true} />;
}
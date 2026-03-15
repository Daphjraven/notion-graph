"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  title: string;
  url: string;
  kind?: "page";
  backlinkCount?: number;
  emoji?: string;
};

type GraphLink = d3.SimulationLinkDatum<GraphNode> & {
  source: string | GraphNode;
  target: string | GraphNode;
  type?: "child" | "mention";
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

function getLinkNodeId(value: string | GraphNode): string {
  return typeof value === "object" ? value.id : value;
}

function isConnectedToSelected(link: GraphLink, selectedId: string | null) {
  if (!selectedId) return false;
  const sourceId = getLinkNodeId(link.source);
  const targetId = getLinkNodeId(link.target);
  return sourceId === selectedId || targetId === selectedId;
}

function nodeIsRelevant(
  node: GraphNode,
  links: GraphLink[],
  selectedId: string | null
) {
  if (!selectedId) return true;
  if (node.id === selectedId) return true;

  return links.some((link) => {
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);

    return (
      (sourceId === selectedId && targetId === node.id) ||
      (targetId === selectedId && sourceId === node.id)
    );
  });
}

export default function NotionGraphView({ pageId }: { pageId: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadGraph() {
      try {
        const res = await fetch(`/api/graph/${pageId}`, { cache: "no-store" });
        const data: GraphData = await res.json();

        if (!mounted) return;

        setGraph({
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
          links: Array.isArray(data.links) ? data.links : [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadGraph();

    return () => {
      mounted = false;
    };
  }, [pageId]);

  const activeNodeId = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (selectedNodeId) return selectedNodeId;
    if (!normalized) return null;

    const match = graph.nodes.find((n) =>
      n.title.toLowerCase().includes(normalized)
    );

    return match?.id ?? null;
  }, [graph.nodes, search, selectedNodeId]);

  useEffect(() => {
    if (!svgRef.current) return;

    let simulation: d3.Simulation<GraphNode, GraphLink> | null = null;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("background", "#111111")
      .style("display", "block");

    const tooltip = d3
      .select("body")
      .append("div")
      .style("position", "fixed")
      .style("pointer-events", "none")
      .style("background", "rgba(20,20,20,0.96)")
      .style("color", "#f3f3f3")
      .style("padding", "8px 10px")
      .style("border-radius", "8px")
      .style("font-size", "12px")
      .style("font-family", "Arial, sans-serif")
      .style("line-height", "1.4")
      .style("border", "1px solid rgba(255,255,255,0.08)")
      .style("box-shadow", "0 8px 24px rgba(0,0,0,0.25)")
      .style("opacity", "0")
      .style("z-index", "9999");

    const g = svg.append("g");

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr("transform", event.transform.toString());
        })
    );

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({ ...l }));

    simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(85)
          .strength(0.55)
      )
      .force("charge", d3.forceManyBody<GraphNode>().strength(-180))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<GraphNode>(18));

    const link = g
      .append("g")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) =>
        isConnectedToSelected(d, activeNodeId) ? "#7dd3fc" : "#777"
      )
      .attr("stroke-opacity", (d) =>
        isConnectedToSelected(d, activeNodeId)
          ? 0.9
          : d.type === "mention"
          ? 0.45
          : 0.28
      )
      .attr("stroke-width", (d) =>
        isConnectedToSelected(d, activeNodeId)
          ? 2
          : d.type === "mention"
          ? 1.2
          : 0.9
      );

    const node = g
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => {
        const base = 5.5;
        const extra = Math.min(d.backlinkCount ?? 0, 5) * 0.9;
        return base + extra;
      })
      .attr("fill", (d) => (d.id === activeNodeId ? "#ffffff" : "#d9d9d9"))
      .attr("stroke", (d) => (d.id === activeNodeId ? "#7dd3fc" : "#f5f5f5"))
      .attr("stroke-width", (d) => (d.id === activeNodeId ? 2 : 0.8))
      .attr("opacity", (d) => (nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22))
      .style("cursor", "pointer")
      .on("mouseenter", (event: MouseEvent, d: GraphNode) => {
        tooltip
          .style("opacity", "1")
          .html(`
            <div style="font-weight:600; margin-bottom:2px;">
              ${d.emoji ? `${d.emoji} ` : ""}${d.title}
            </div>
            <div style="color:#bdbdbd;">Backlinks: ${d.backlinkCount ?? 0}</div>
          `);
      })
      .on("mousemove", (event: MouseEvent) => {
        tooltip
          .style("left", `${event.clientX + 12}px`)
          .style("top", `${event.clientY + 12}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", "0");
      })
      .on("click", (_event: MouseEvent, d: GraphNode) => {
        setSelectedNodeId(d.id);
      })
      .on("dblclick", (_event: MouseEvent, d: GraphNode) => {
        if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
      })
      .call(
        d3
          .drag<SVGCircleElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation?.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const iconLabel = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text.icon")
      .data(nodes.filter((d) => Boolean(d.emoji)))
      .join("text")
      .text((d) => d.emoji ?? "")
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .attr("opacity", (d) => (nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22));

    const label = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text.label")
      .data(nodes)
      .join("text")
      .text((d) =>
        d.title.length > 28 ? `${d.title.slice(0, 28)}...` : d.title
      )
      .attr("fill", "#d6d6d6")
      .attr("font-size", 8.5)
      .attr("font-family", "Arial, sans-serif")
      .attr("pointer-events", "none")
      .attr("opacity", (d) => (nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22));

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (typeof d.source === "object" ? d.source.x ?? 0 : 0))
        .attr("y1", (d) => (typeof d.source === "object" ? d.source.y ?? 0 : 0))
        .attr("x2", (d) => (typeof d.target === "object" ? d.target.x ?? 0 : 0))
        .attr("y2", (d) => (typeof d.target === "object" ? d.target.y ?? 0 : 0));

      node
        .attr("cx", (d) => d.x ?? 0)
        .attr("cy", (d) => d.y ?? 0);

      iconLabel
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - 10);

      label
        .attr("x", (d) => (d.x ?? 0) + 8)
        .attr("y", (d) => (d.y ?? 0) + 3);
    });

    return () => {
      tooltip.remove();
      simulation?.stop();
    };
  }, [graph, activeNodeId]);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        background: "#111111",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 20,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(20,20,20,0.9)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "10px 12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        <input
          value={search}
          onChange={(e) => {
            setSelectedNodeId(null);
            setSearch(e.target.value);
          }}
          placeholder="Search nodes..."
          style={{
            background: "transparent",
            color: "#f3f3f3",
            border: "none",
            outline: "none",
            fontSize: "13px",
            width: 220,
            fontFamily: "Arial, sans-serif",
          }}
        />
        {(search || selectedNodeId) && (
          <button
            onClick={() => {
              setSearch("");
              setSelectedNodeId(null);
            }}
            style={{
              background: "#1f2937",
              color: "#e5e7eb",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#cfcfcf",
            fontSize: "12px",
            fontFamily: "Arial, sans-serif",
            zIndex: 10,
          }}
        >
          Loading graph...
        </div>
      )}

      <svg
        ref={svgRef}
        style={{
          width: "100vw",
          height: "100vh",
        }}
      />
    </main>
  );
}
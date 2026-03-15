"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

type GraphGroup = "core" | "belt" | "orphan";

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  title: string;
  url: string;
  kind?: "page";
  backlinkCount?: number;
  emoji?: string;
  degree?: number;
  group?: GraphGroup;
};

type IndexedGraphNode = GraphNode & {
  __index: number;
};

type GraphLink = {
  source: string | IndexedGraphNode;
  target: string | IndexedGraphNode;
  type?: "child" | "mention" | "link";
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
  root?: {
    id: string;
    title: string;
  };
};

function getLinkNodeId(value: string | IndexedGraphNode): string {
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

function buildNodeMeta(nodes: GraphNode[], links: GraphLink[]) {
  const degreeMap = new Map<string, number>();

  for (const node of nodes) {
    degreeMap.set(node.id, 0);
  }

  for (const link of links) {
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);

    degreeMap.set(sourceId, (degreeMap.get(sourceId) ?? 0) + 1);
    degreeMap.set(targetId, (degreeMap.get(targetId) ?? 0) + 1);
  }

  return nodes.map((node) => {
    const degree = degreeMap.get(node.id) ?? 0;

    let group: GraphGroup = "core";
    if (degree === 0) group = "orphan";
    else if (degree <= 1 && node.id !== nodes[0]?.id) group = "belt";

    return {
      ...node,
      degree,
      group,
    };
  });
}

export default function NotionGraphView({ pageId }: { pageId: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  return params.get("focus");
});
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadGraph() {
      try {
        setLoading(true);
        setErrorText("");

        const res = await fetch(`/api/graph/${pageId}`, { cache: "no-store" });
        const data = await res.json();

        if (!mounted) return;

        if (!res.ok) {
          setErrorText(JSON.stringify(data, null, 2));
          setGraph({ nodes: [], links: [] });
          return;
        }

        const incomingNodes = Array.isArray(data.nodes) ? data.nodes : [];
        const incomingLinks = Array.isArray(data.links) ? data.links : [];

        const MAX_NODES = 80;
        const MAX_LINKS = 140;

        const trimmedNodes = incomingNodes.slice(0, MAX_NODES);
        const allowedIds = new Set(trimmedNodes.map((n: GraphNode) => n.id));

        const trimmedLinks = incomingLinks
          .filter((l: GraphLink) => {
            const sourceId = getLinkNodeId(l.source);
            const targetId = getLinkNodeId(l.target);
            return allowedIds.has(sourceId) && allowedIds.has(targetId);
          })
          .slice(0, MAX_LINKS);

        if (trimmedNodes.length === 0 && data.root?.id) {
          setGraph({
            nodes: [
              {
                id: data.root.id,
                title: data.root.title ?? "Untitled",
                url: "",
                kind: "page",
                backlinkCount: 0,
                group: "core",
              },
            ],
            links: [],
            root: data.root,
          });
        } else {
          setGraph({
            nodes: trimmedNodes,
            links: trimmedLinks,
            root: data.root,
          });
        }
      } catch (err) {
        console.error(err);
        if (mounted) {
          setErrorText(String(err));
          setGraph({ nodes: [], links: [] });
        }
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

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (graph.nodes.length === 0) return;

    let simulation: d3.Simulation<IndexedGraphNode, GraphLink> | null = null;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const rootId = graph.root?.id ?? graph.nodes[0]?.id ?? null;

    const beltRadius = Math.min(width, height) * 0.35;
    const orphanRadius = Math.min(width, height) * 0.52;

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

    let nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({ ...l }));

    nodes = buildNodeMeta(nodes, links);

    const indexedNodes: IndexedGraphNode[] = nodes.map((node, index) => ({
      ...node,
      __index: index,
    }));

    const nodeById = new Map(indexedNodes.map((n) => [n.id, n]));

    simulation = d3
      .forceSimulation<IndexedGraphNode>(indexedNodes)
      .force(
        "link",
        d3
          .forceLink<IndexedGraphNode, any>(links as any)
          .id((d) => d.id)
          .distance((link: any) => {
            const sourceId = getLinkNodeId(link.source);
            const targetId = getLinkNodeId(link.target);
            const source = nodeById.get(sourceId);
            const target = nodeById.get(targetId);

            if (source?.group === "orphan" || target?.group === "orphan") {
              return 180;
            }

            if (source?.group === "belt" || target?.group === "belt") {
              return 140;
            }

            return 100;
          })
          .strength((link: any) => {
            const sourceId = getLinkNodeId(link.source);
            const targetId = getLinkNodeId(link.target);
            const source = nodeById.get(sourceId);
            const target = nodeById.get(targetId);

            if (source?.group === "orphan" || target?.group === "orphan") {
              return 0.03;
            }

            if (source?.group === "belt" || target?.group === "belt") {
              return 0.12;
            }

            return 0.45;
          })
      )
      .force("charge", d3.forceManyBody<IndexedGraphNode>().strength(-220))
      .force("center", d3.forceCenter(centerX, centerY))
      .force(
        "collision",
        d3.forceCollide<IndexedGraphNode>().radius((d) => {
          const base =
            d.id === rootId
              ? 14
              : d.group === "orphan"
              ? 9
              : d.group === "belt"
              ? 8
              : 8;

          const extra = Math.sqrt(d.backlinkCount ?? 0) * 2;
          return base + extra;
        })
      )
      .force(
        "x",
        d3
          .forceX<IndexedGraphNode>((d) => {
            if (d.id === rootId) return centerX;

            const angle =
              ((d.__index + 1) / Math.max(indexedNodes.length, 1)) *
              Math.PI *
              2;

            if (d.group === "orphan") {
              return centerX + Math.cos(angle) * orphanRadius;
            }

            if (d.group === "belt") {
              return centerX + Math.cos(angle) * beltRadius;
            }

            return centerX;
          })
          .strength((d) => {
            if (d.id === rootId) return 0.24;
            if (d.group === "orphan") return 0.34;
            if (d.group === "belt") return 0.16;
            return 0.06;
          })
      )
      .force(
        "y",
        d3
          .forceY<IndexedGraphNode>((d) => {
            if (d.id === rootId) return centerY;

            const angle =
              ((d.__index + 1) / Math.max(indexedNodes.length, 1)) *
              Math.PI *
              2;

            if (d.group === "orphan") {
              return centerY + Math.sin(angle) * orphanRadius;
            }

            if (d.group === "belt") {
              return centerY + Math.sin(angle) * beltRadius;
            }

            return centerY;
          })
          .strength((d) => {
            if (d.id === rootId) return 0.24;
            if (d.group === "orphan") return 0.34;
            if (d.group === "belt") return 0.16;
            return 0.06;
          })
      );

    simulation.alpha(0.6).restart();

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
          : 0.18
      )
      .attr("stroke-width", (d) =>
        isConnectedToSelected(d, activeNodeId)
          ? 2
          : d.type === "mention"
          ? 1.1
          : 0.8
      );

    const node = g
      .append("g")
      .selectAll<SVGCircleElement, IndexedGraphNode>("circle")
      .data(indexedNodes)
      .join("circle")
      .attr("r", (d) => {
        const base =
          d.id === rootId
            ? 10
            : d.group === "orphan"
            ? 7
            : d.group === "belt"
            ? 5.5
            : 6;

        const extra = Math.sqrt(d.backlinkCount ?? 0) * 1.8;
        return base + extra;
      })
      .attr("fill", (d) => {
        if (d.id === rootId) return "#4ade80";
        if (d.id === activeNodeId) return "#ffffff";
        if (d.group === "orphan") return "#c084fc";
        if (d.group === "belt") return "#93c5fd";
        return "#d9d9d9";
      })
      .attr("stroke", (d) => {
        if (d.id === rootId) return "#86efac";
        if (d.id === activeNodeId) return "#7dd3fc";
        if (d.group === "orphan") return "#d8b4fe";
        if (d.group === "belt") return "#bfdbfe";
        return "#f5f5f5";
      })
      .attr("stroke-width", (d) => {
        if (d.id === rootId) return 2.2;
        if (d.id === activeNodeId) return 2;
        return d.group === "orphan" ? 0.8 : 0.7;
      })
      .attr("opacity", (d) =>
        nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22
      )
      .style("cursor", "pointer")
      .on("mouseenter", (_event: MouseEvent, d) => {
        tooltip
          .style("opacity", "1")
          .html(`
            <div style="font-weight:600; margin-bottom:2px;">
              ${d.emoji ? `${d.emoji} ` : ""}${d.title}
            </div>
            <div style="color:#bdbdbd;">Backlinks: ${d.backlinkCount ?? 0}</div>
            <div style="color:#94a3b8;">
              ${
                d.id === rootId
                  ? "Root page"
                  : d.group === "orphan"
                  ? "Orphan ring"
                  : d.group === "belt"
                  ? "Asteroid belt"
                  : "Core cluster"
              }
            </div>
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
      .on("click", (_event: MouseEvent, d) => {
        setSelectedNodeId(d.id);

        const url = new URL(window.location.href);
        url.searchParams.set("focus", d.id);
        window.history.replaceState({}, "", url.toString());
    })
      .on("dblclick", (_event: MouseEvent, d) => {
        if (d.url) {
          window.open(d.url, "_blank", "noopener,noreferrer");
        }
      })
      .call(
        d3
          .drag<SVGCircleElement, any>()
          .on("start", (event: any, d: any) => {
            if (!event.active) simulation?.alphaTarget(0.2).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event: any, d: any) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event: any, d: any) => {
            if (!event.active) simulation?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const emojiLabel = g
      .append("g")
      .selectAll<SVGTextElement, IndexedGraphNode>("text.emoji")
      .data(indexedNodes.filter((d) => Boolean(d.emoji)))
      .join("text")
      .text((d) => d.emoji ?? "")
      .attr("font-size", (d) => (d.id === rootId ? 15 : 11))
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .attr("opacity", (d) =>
        nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22
      );

    const label = g
      .append("g")
      .selectAll<SVGTextElement, IndexedGraphNode>("text.label")
      .data(indexedNodes)
      .join("text")
      .text((d) =>
        d.title.length > 28 ? `${d.title.slice(0, 28)}...` : d.title
      )
      .attr("fill", (d) => {
        if (d.id === rootId) return "#bbf7d0";
        if (d.group === "orphan") return "#e9d5ff";
        if (d.group === "belt") return "#dbeafe";
        return "#d6d6d6";
      })
      .attr("font-size", (d) => {
        if (d.id === rootId) return 10.5;
        if (d.group === "orphan") return 7.5;
        if (d.group === "belt") return 7.5;
        return 8.5;
      })
      .attr("font-weight", (d) => (d.id === rootId ? "600" : "400"))
      .attr("font-family", "Arial, sans-serif")
      .attr("pointer-events", "none")
      .attr("opacity", (d) =>
        nodeIsRelevant(d, links, activeNodeId) ? 1 : 0.22
      );

    simulation.on("tick", () => {
      link
        .attr("x1", (d) =>
          typeof d.source === "object" ? d.source.x ?? 0 : 0
        )
        .attr("y1", (d) =>
          typeof d.source === "object" ? d.source.y ?? 0 : 0
        )
        .attr("x2", (d) =>
          typeof d.target === "object" ? d.target.x ?? 0 : 0
        )
        .attr("y2", (d) =>
          typeof d.target === "object" ? d.target.y ?? 0 : 0
        );

      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

      emojiLabel
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - 9);

      label
        .attr("x", (d) => (d.x ?? 0) + 9)
        .attr("y", (d) => (d.y ?? 0) + 4);
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

      {!loading && errorText && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f87171",
            fontSize: "13px",
            fontFamily: "Arial, sans-serif",
            zIndex: 10,
            padding: 24,
            textAlign: "center",
            whiteSpace: "pre-wrap",
          }}
        >
          {errorText}
        </div>
      )}

      {!loading && !errorText && graph.nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#cfcfcf",
            fontSize: "14px",
            fontFamily: "Arial, sans-serif",
            zIndex: 10,
          }}
        >
          No graph nodes found for this page yet.
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
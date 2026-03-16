"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

type GraphNode = {
  id: string;
  title: string;
  url: string;
  kind?: "page";
  backlinkCount?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  type?: "child" | "mention";
};

type SavedGraphState = {
  pageId: string;
  zoom: {
    x: number;
    y: number;
    k: number;
  };
  positions: Record<string, { x: number; y: number }>;
  updatedAt?: string;
};

type Props = {
  pageId: string;
  embedMode?: boolean;
};

export default function GraphCanvas({ pageId, embedMode = false }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [status, setStatus] = useState("Loading graph...");

  useEffect(() => {
    let mounted = true;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentZoom = { x: 0, y: 0, k: 1 };

    async function draw() {
      try {
        const [graphRes, stateRes] = await Promise.all([
          fetch(`/api/graph/${pageId}`, { cache: "no-store" }),
          fetch(`/api/graph-state/${pageId}`, { cache: "no-store" }),
        ]);

        if (!graphRes.ok) {
          throw new Error(`Graph API failed: ${await graphRes.text()}`);
        }

        const graphJson = await graphRes.json();
        const nodes: GraphNode[] = graphJson.nodes || [];
        const links: GraphLink[] = graphJson.links || [];

        let savedState: SavedGraphState | null = null;
        if (stateRes.ok) {
          const stateJson = await stateRes.json();
          savedState = stateJson.state || null;
        }

        if (!mounted || !svgRef.current) return;

        if (nodes.length === 0) {
          setStatus("No nodes found for this page.");
          return;
        }

        if (savedState?.positions) {
          for (const node of nodes) {
            const savedPos = savedState.positions[node.id];
            if (savedPos) {
              node.x = savedPos.x;
              node.y = savedPos.y;
            }
          }
        }

        setStatus("");

        const width = window.innerWidth;
        const height = window.innerHeight;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        svg
          .attr("viewBox", `0 0 ${width} ${height}`)
          .style("background", "#111111")
          .style("display", "block");

        const g = svg.append("g");

        const scheduleSave = async () => {
          if (saveTimeout) clearTimeout(saveTimeout);

          saveTimeout = setTimeout(async () => {
            const positions: Record<string, { x: number; y: number }> = {};

            for (const node of nodes) {
              if (typeof node.x === "number" && typeof node.y === "number") {
                positions[node.id] = { x: node.x, y: node.y };
              }
            }

            const payload = {
              zoom: currentZoom,
              positions,
            };

            try {
              await fetch(`/api/graph-state/${pageId}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
              });
            } catch (error) {
              console.error("Save state failed:", error);
            }
          }, 500);
        };

        const zoomBehavior = d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.3, 3])
          .on("zoom", (event) => {
            g.attr("transform", event.transform);
            currentZoom = {
              x: event.transform.x,
              y: event.transform.y,
              k: event.transform.k,
            };
            scheduleSave();
          });

        svg.call(zoomBehavior);

        const simulation = d3
          .forceSimulation(nodes as d3.SimulationNodeDatum[])
          .force(
            "link",
            d3
              .forceLink(nodes as any)
              .links(links as any)
              .id((d: any) => d.id)
              .distance(embedMode ? 85 : 95)
              .strength(0.55)
          )
          .force("charge", d3.forceManyBody().strength(embedMode ? -180 : -220))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collide", d3.forceCollide(embedMode ? 18 : 20));

        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .join("line")
          .attr("stroke", "#777")
          .attr("stroke-opacity", (d) => (d.type === "mention" ? 0.45 : 0.28))
          .attr("stroke-width", (d) => (d.type === "mention" ? 1.2 : 0.9));

        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .join("circle")
          .attr("r", (d) => {
            const base = embedMode ? 5.5 : 7;
            const extra = Math.min(d.backlinkCount ?? 0, 5) * (embedMode ? 0.9 : 1.1);
            return base + extra;
          })
          .attr("fill", embedMode ? "#d9d9d9" : "#e2e2e2")
          .attr("stroke", "#f5f5f5")
          .attr("stroke-width", 0.8)
          .style("cursor", "pointer")
          .on("click", (_, d) => {
            if (d.url) window.open(d.url, "_blank");
          })
          .call(
            d3
              .drag<SVGCircleElement, GraphNode>()
              .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.25).restart();
                d.fx = d.x;
                d.fy = d.y;
              })
              .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
              })
              .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
                scheduleSave();
              })
          );

        const label = g
          .append("g")
          .selectAll("text")
          .data(nodes)
          .join("text")
          .text((d) =>
            d.title.length > (embedMode ? 28 : 36)
              ? `${d.title.slice(0, embedMode ? 28 : 36)}...`
              : d.title
          )
          .attr("fill", "#d6d6d6")
          .attr("font-size", embedMode ? 8.5 : 11)
          .attr("font-family", "Arial, sans-serif")
          .attr("pointer-events", "none");

        simulation.on("tick", () => {
          link
            .attr("x1", (d: any) => d.source.x)
            .attr("y1", (d: any) => d.source.y)
            .attr("x2", (d: any) => d.target.x)
            .attr("y2", (d: any) => d.target.y);

          node
            .attr("cx", (d: any) => d.x)
            .attr("cy", (d: any) => d.y);

          label
            .attr("x", (d: any) => d.x + (embedMode ? 8 : 10))
            .attr("y", (d: any) => d.y + 3);
        });

        if (savedState?.zoom) {
          currentZoom = savedState.zoom;
          svg.call(
            zoomBehavior.transform,
            d3.zoomIdentity
              .translate(savedState.zoom.x, savedState.zoom.y)
              .scale(savedState.zoom.k)
          );
        }
      } catch (err: any) {
        console.error(err);
        if (mounted) setStatus(err?.message || "Graph failed to load.");
      }
    }

    draw();

    return () => {
      mounted = false;
      if (saveTimeout) clearTimeout(saveTimeout);
    };
  }, [pageId, embedMode]);

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
      {status ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#d6d6d6",
            fontSize: embedMode ? "12px" : "14px",
            fontFamily: "Arial, sans-serif",
            zIndex: 2,
            textAlign: "center",
            padding: "24px",
          }}
        >
          {status}
        </div>
      ) : null}

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
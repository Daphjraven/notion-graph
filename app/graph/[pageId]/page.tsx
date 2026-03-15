"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

type GraphNode = {
  id: string;
  title: string;
  url: string;
  kind: "page";
  backlinkCount?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: "child" | "mention";
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
};

export default function GraphPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function draw() {
      const { pageId } = await params;
      const res = await fetch(`/api/graph/${pageId}`);
      const graph = await res.json();

      if (!mounted || !svgRef.current) return;

      const nodes: GraphNode[] = graph.nodes || [];
      const links: GraphLink[] = graph.links || [];

      const width = window.innerWidth;
      const height = window.innerHeight;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("viewBox", `0 0 ${width} ${height}`).style("background", "#0b1020");

      const g = svg.append("g");

      svg.call(
        d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.2, 4])
          .on("zoom", (event) => {
            g.attr("transform", event.transform);
          })
      );

      const simulation = d3
        .forceSimulation(nodes as d3.SimulationNodeDatum[])
        .force(
          "link",
          d3
            .forceLink(nodes as any)
            .links(links as any)
            .id((d: any) => d.id)
            .distance(120)
        )
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide(40));

      const link = g
  .append("g")
  .selectAll("line")
  .data(links)
  .join("line")
  .attr("stroke", (d) => (d.type === "mention" ? "#7dd3fc" : "#94a3b8"))
  .attr("stroke-opacity", (d) => (d.type === "mention" ? 0.55 : 0.22))
  .attr("stroke-width", (d) => (d.type === "mention" ? 1.8 : 1.1));

const node = g
  .append("g")
  .selectAll("circle")
  .data(nodes)
  .join("circle")
  .attr("r", (d) => 12 + Math.min(d.backlinkCount ?? 0, 10))
  .attr("fill", "#8ecae6")
  .attr("stroke", "white")
  .attr("stroke-width", 1.5)
  .style("cursor", "pointer")
  .on("click", (_, d) => {
    if (d.url) window.open(d.url, "_blank");
  });

      const label = g
        .append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text((d) => d.title)
        .attr("fill", "#e2e8f0")
        .attr("font-size", 13)
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
          .attr("x", (d: any) => d.x + 24)
          .attr("y", (d: any) => d.y + 4);
      });
    }

    draw();
    return () => {
      mounted = false;
    };
  }, [params]);

  return <svg ref={svgRef} style={{ width: "100vw", height: "100vh" }} />;
}
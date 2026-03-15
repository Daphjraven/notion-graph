import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

function getNotionClient() {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    throw new Error("Missing NOTION_TOKEN environment variable");
  }

  return new Client({ auth: token });
}

type GraphGroup = "core" | "belt" | "orphan";

type GraphNode = {
  id: string;
  title: string;
  url: string;
  kind: "page";
  backlinkCount: number;
  emoji?: string;
  group: GraphGroup;
};

type GraphLink = {
  source: string;
  target: string;
  type: "child" | "mention" | "link";
};

function notionUrlFromId(id: string) {
  return `https://notion.so/${id.replace(/-/g, "")}`;
}

function getPageTitle(page: any): string {
  if (!page?.properties) return "Untitled";

  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (
      prop?.type === "title" &&
      Array.isArray(prop.title) &&
      prop.title.length
    ) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }

  return "Untitled";
}

function getPageEmoji(page: any): string | undefined {
  if (page?.icon?.type === "emoji") {
    return page.icon.emoji;
  }
  return undefined;
}

function getPageUrl(page: { id: string } & Record<string, unknown>): string {
  if ("url" in page && typeof page.url === "string") {
    return page.url;
  }
  return notionUrlFromId(page.id);
}

function normalizePageId(raw: string) {
  const cleaned = raw.replace(/[^a-fA-F0-9]/g, "");
  if (cleaned.length !== 32) return raw;
  return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(
    12,
    16
  )}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
}

async function listBlockChildren(notion: Client, blockId: string) {
  const results: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    results.push(...response.results);

    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  return results;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  try {
    const notion = getNotionClient();
    const { pageId: rawPageId } = await context.params;
    const rootPageId = normalizePageId(rawPageId);

    const rootPage = await notion.pages.retrieve({ page_id: rootPageId });

    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];
    const backlinkCounts = new Map<string, number>();
    const visitedPages = new Set<string>();
    const visitedBlocks = new Set<string>();

    async function addPage(pageId: string, group: GraphGroup = "core") {
      const normalizedId = normalizePageId(pageId);

      if (nodeMap.has(normalizedId)) {
        const existing = nodeMap.get(normalizedId)!;
        if (existing.group !== "core" && group === "core") {
          existing.group = "core";
          nodeMap.set(normalizedId, existing);
        }
        return;
      }

      const page = await notion.pages.retrieve({ page_id: normalizedId });

      nodeMap.set(normalizedId, {
        id: page.id,
        title: getPageTitle(page),
        url: getPageUrl(page),
        kind: "page",
        backlinkCount: backlinkCounts.get(page.id) ?? 0,
        emoji: getPageEmoji(page),
        group,
      });
    }

    function bumpBacklink(targetId: string) {
      backlinkCounts.set(targetId, (backlinkCounts.get(targetId) ?? 0) + 1);
    }

    async function connectPage(
      sourcePageId: string,
      targetPageId: string,
      type: GraphLink["type"],
      depth: number
    ) {
      const normalizedTargetId = normalizePageId(targetPageId);

      try {
        await addPage(normalizedTargetId, "core");

        links.push({
          source: sourcePageId,
          target: normalizedTargetId,
          type,
        });

        bumpBacklink(normalizedTargetId);

        await walkPage(normalizedTargetId, depth + 1);
      } catch {
        // ignore inaccessible or invalid pages
      }
    }

    async function walkBlocks(
      sourcePageId: string,
      blockId: string,
      depth: number
    ) {
      const normalizedBlockId = normalizePageId(blockId);
      const visitKey = `${sourcePageId}:${normalizedBlockId}`;

      if (visitedBlocks.has(visitKey)) return;
      visitedBlocks.add(visitKey);

      let children: any[] = [];
      try {
        children = await listBlockChildren(notion, normalizedBlockId);
      } catch {
        return;
      }

      for (const block of children) {
        if (block.type === "child_page") {
          await connectPage(sourcePageId, block.id, "child", depth);
        }

        if (
          block.type === "link_to_page" &&
          block.link_to_page?.type === "page_id"
        ) {
          await connectPage(
            sourcePageId,
            block.link_to_page.page_id,
            "link",
            depth
          );
        }

        const maybeValue = (block as any)[block.type];
        if (maybeValue?.rich_text && Array.isArray(maybeValue.rich_text)) {
          for (const item of maybeValue.rich_text) {
            if (item?.type === "mention" && item?.mention?.type === "page") {
              await connectPage(
                sourcePageId,
                item.mention.page.id,
                "mention",
                depth
              );
            }
          }
        }

        // Limited nested recursion for performance
        if (block.has_children && depth < 2) {
          await walkBlocks(sourcePageId, block.id, depth + 1);
        }
      }
    }

    async function walkPage(pageId: string, depth = 0) {
      const normalizedId = normalizePageId(pageId);

      if (visitedPages.has(normalizedId)) return;
      if (depth > 2) return;

      visitedPages.add(normalizedId);
      await addPage(normalizedId, "core");

      await walkBlocks(normalizedId, normalizedId, depth);
    }

    await walkPage(rootPage.id, 0);

    const nodes = Array.from(nodeMap.values()).map((node) => ({
      ...node,
      backlinkCount: backlinkCounts.get(node.id) ?? node.backlinkCount ?? 0,
      emoji:
        node.id === rootPage.id
          ? getPageEmoji(rootPage) ?? node.emoji
          : node.emoji,
    }));

    return NextResponse.json({
      nodes,
      links,
      root: {
        id: rootPage.id,
        title: getPageTitle(rootPage),
      },
    });
  } catch (error: any) {
    console.error("Graph route error:", error?.body || error);

    return NextResponse.json(
      {
        error: "Failed to load graph",
        details: error?.body || String(error),
      },
      { status: 500 }
    );
  }
}
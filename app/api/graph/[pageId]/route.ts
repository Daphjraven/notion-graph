import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

function getNotionClient() {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    throw new Error("Missing NOTION_TOKEN environment variable");
  }

  return new Client({ auth: token });
}

type GraphNode = {
  id: string;
  title: string;
  url: string;
  kind: "page";
  backlinkCount: number;
  emoji?: string;
};

type GraphLink = {
  source: string;
  target: string;
  type: "child" | "mention";
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
    const visited = new Set<string>();

    async function addPage(pageId: string) {
      const normalizedId = normalizePageId(pageId);
      if (nodeMap.has(normalizedId)) return;

      const page = await notion.pages.retrieve({ page_id: normalizedId });

      nodeMap.set(normalizedId, {
        id: page.id,
        title: getPageTitle(page),
        url: getPageUrl(page),
        kind: "page",
        backlinkCount: backlinkCounts.get(page.id) ?? 0,
        emoji: getPageEmoji(page),
      });
    }

    async function walkPage(pageId: string, depth = 0) {
      const normalizedId = normalizePageId(pageId);
      if (visited.has(normalizedId)) return;
      if (depth > 2) return;

      visited.add(normalizedId);

      let children: any[] = [];
      try {
        children = await listBlockChildren(notion, normalizedId);
      } catch {
        return;
      }

      for (const block of children) {
        if (block.type === "child_page") {
          const childTitle = block.child_page?.title || "Untitled";
          const childId = block.id;

          if (!nodeMap.has(childId)) {
            nodeMap.set(childId, {
              id: childId,
              title: childTitle,
              url: notionUrlFromId(childId),
              kind: "page",
              backlinkCount: backlinkCounts.get(childId) ?? 0,
            });
          }

          links.push({
            source: normalizedId,
            target: childId,
            type: "child",
          });

          backlinkCounts.set(childId, (backlinkCounts.get(childId) ?? 0) + 1);
          await walkPage(childId, depth + 1);
        }

        const richTextArrays: any[][] = [];
        const maybeValue = (block as any)[block.type];

        if (maybeValue?.rich_text && Array.isArray(maybeValue.rich_text)) {
          richTextArrays.push(maybeValue.rich_text);
        }

        for (const richText of richTextArrays) {
          for (const item of richText) {
            if (item?.type === "mention" && item?.mention?.type === "page") {
              const mentionedId = normalizePageId(item.mention.page.id);

              if (!nodeMap.has(mentionedId)) {
                try {
                  const mentionedPage = await notion.pages.retrieve({
                    page_id: mentionedId,
                  });

                  nodeMap.set(mentionedId, {
                    id: mentionedPage.id,
                    title: getPageTitle(mentionedPage),
                    url: getPageUrl(mentionedPage),
                    kind: "page",
                    backlinkCount: backlinkCounts.get(mentionedPage.id) ?? 0,
                    emoji: getPageEmoji(mentionedPage),
                  });
                } catch {
                  continue;
                }
              }

              links.push({
                source: normalizedId,
                target: mentionedId,
                type: "mention",
              });

              backlinkCounts.set(
                mentionedId,
                (backlinkCounts.get(mentionedId) ?? 0) + 1
              );
            }
          }
        }
      }
    }

    await addPage(rootPage.id);
    await walkPage(rootPage.id);

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
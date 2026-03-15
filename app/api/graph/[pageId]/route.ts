import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

type GraphNode = {
  id: string;
  title: string;
  url: string;
  kind: "page";
  backlinkCount?: number;
};

type GraphLink = {
  source: string;
  target: string;
  type: "child" | "mention";
};

function notionUrlFromId(id: string) {
  return `https://notion.so/${id.replace(/-/g, "")}`;
}

function normalizePageId(raw: string) {
  const cleaned = raw.replace(/[^a-fA-F0-9]/g, "");
  if (cleaned.length !== 32) return raw;
  return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
}

function dedupeLinks(links: GraphLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.source}::${link.target}::${link.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addBacklinkCounts(nodes: GraphNode[], links: GraphLink[]) {
  const incoming = new Map<string, number>();

  for (const link of links) {
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
  }

  return nodes.map((node) => ({
    ...node,
    backlinkCount: incoming.get(node.id) ?? 0,
  }));
}

async function getPageTitle(pageId: string): Promise<string> {
  try {
    const page: any = await notion.pages.retrieve({ page_id: pageId });

    if (page.properties) {
      const titleProp = Object.values(page.properties).find(
        (prop: any) => prop?.type === "title"
      ) as any;

      return (
        titleProp?.title?.map((t: any) => t.plain_text).join("") || "Untitled"
      );
    }

    return "Untitled";
  } catch {
    return "Untitled";
  }
}

async function getChildBlocks(blockId: string) {
  const results: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const response: any = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    results.push(...response.results);

    if (!response.has_more) break;
    cursor = response.next_cursor ?? undefined;
  }

  return results;
}

function getBlockRichText(block: any): any[] {
  const type = block?.type;
  if (!type) return [];
  const value = block[type];
  if (!value) return [];
  return Array.isArray(value.rich_text) ? value.rich_text : [];
}

function extractMentionedPageIdsFromBlock(block: any): string[] {
  const richText = getBlockRichText(block);
  const ids: string[] = [];

  for (const rt of richText) {
    if (rt?.type === "mention" && rt?.mention?.type === "page") {
      const pageId = rt.mention.page?.id;
      if (pageId) ids.push(pageId);
    }
  }

  return ids;
}

async function crawlPageTree(
  pageId: string,
  maxDepth: number,
  depth = 0,
  nodes = new Map<string, GraphNode>(),
  links: GraphLink[] = [],
  visited = new Set<string>()
) {
  if (depth > maxDepth) return { nodes, links };
  if (visited.has(pageId)) return { nodes, links };
  visited.add(pageId);

  if (!nodes.has(pageId)) {
    const title = await getPageTitle(pageId);
    nodes.set(pageId, {
      id: pageId,
      title,
      url: notionUrlFromId(pageId),
      kind: "page",
    });
  }

  const blocks = await getChildBlocks(pageId);

  for (const block of blocks) {
    // 1. child page links
    if (block.type === "child_page") {
      const childId = block.id;
      const childTitle = block.child_page?.title || "Untitled";

      if (!nodes.has(childId)) {
        nodes.set(childId, {
          id: childId,
          title: childTitle,
          url: notionUrlFromId(childId),
          kind: "page",
        });
      }

      links.push({
        source: pageId,
        target: childId,
        type: "child",
      });

      await crawlPageTree(childId, maxDepth, depth + 1, nodes, links, visited);
    }

    // 2. page mentions inside rich text
    const mentionedPageIds = extractMentionedPageIdsFromBlock(block);

    for (const mentionedId of mentionedPageIds) {
      if (!nodes.has(mentionedId)) {
        const mentionedTitle = await getPageTitle(mentionedId);
        nodes.set(mentionedId, {
          id: mentionedId,
          title: mentionedTitle,
          url: notionUrlFromId(mentionedId),
          kind: "page",
        });
      }

      links.push({
        source: pageId,
        target: mentionedId,
        type: "mention",
      });
    }

    // 3. recurse into nested blocks like toggles, callouts, synced blocks, etc.
    if (block.has_children) {
      const nestedBlocks = await getChildBlocks(block.id);

      for (const nestedBlock of nestedBlocks) {
        const nestedMentionIds = extractMentionedPageIdsFromBlock(nestedBlock);

        for (const mentionedId of nestedMentionIds) {
          if (!nodes.has(mentionedId)) {
            const mentionedTitle = await getPageTitle(mentionedId);
            nodes.set(mentionedId, {
              id: mentionedId,
              title: mentionedTitle,
              url: notionUrlFromId(mentionedId),
              kind: "page",
            });
          }

          links.push({
            source: pageId,
            target: mentionedId,
            type: "mention",
          });
        }

        if (nestedBlock.type === "child_page") {
          const childId = nestedBlock.id;
          const childTitle = nestedBlock.child_page?.title || "Untitled";

          if (!nodes.has(childId)) {
            nodes.set(childId, {
              id: childId,
              title: childTitle,
              url: notionUrlFromId(childId),
              kind: "page",
            });
          }

          links.push({
            source: pageId,
            target: childId,
            type: "child",
          });

          await crawlPageTree(childId, maxDepth, depth + 1, nodes, links, visited);
        }
      }
    }
  }

  return { nodes, links };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params;
    const normalizedPageId = normalizePageId(pageId);

    const crawled = await crawlPageTree(normalizedPageId, 3);
    const uniqueLinks = dedupeLinks(crawled.links);
    const finalNodes = addBacklinkCounts(
      Array.from(crawled.nodes.values()),
      uniqueLinks
    );

    return Response.json({
      nodes: finalNodes,
      links: uniqueLinks,
    });
  } catch (error: any) {
    console.error("Notion API error:", error);
    return Response.json(
      {
        error: "Notion API failed",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
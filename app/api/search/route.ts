import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

function getPageTitle(result: any): string {
  if (!result.properties) return "Untitled";

  for (const key of Object.keys(result.properties)) {
    const prop = result.properties[key];
    if (prop?.type === "title" && prop.title?.length) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }

  return "Untitled";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim() || "";

  if (!query) {
    return NextResponse.json([]);
  }

  try {
    const response = await notion.search({
      query,
      filter: {
        value: "page",
        property: "object",
      },
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
      page_size: 10,
    });

    const results = response.results.map((result: any) => ({
      id: result.id,
      title: getPageTitle(result),
      url: result.url,
      last_edited_time: result.last_edited_time,
    }));

    return NextResponse.json(results);
  } catch (error) {
    console.error("Notion search failed:", error);
    return NextResponse.json(
      { error: "Failed to search Notion pages" },
      { status: 500 }
    );
  }
}
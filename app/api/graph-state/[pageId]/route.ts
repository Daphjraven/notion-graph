import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{ pageId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { pageId } = await params;

    const { data, error } = await supabaseAdmin
      .from("graph_states")
      .select("page_id, zoom_x, zoom_y, zoom_k, positions, updated_at")
      .eq("page_id", pageId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      state: data
        ? {
            pageId: data.page_id,
            zoom: {
              x: data.zoom_x,
              y: data.zoom_y,
              k: data.zoom_k,
            },
            positions: data.positions || {},
            updatedAt: data.updated_at,
          }
        : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to load graph state",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { pageId } = await params;
    const body = await request.json();

    const zoom = body?.zoom || { x: 0, y: 0, k: 1 };
    const positions = body?.positions || {};

    const payload = {
      page_id: pageId,
      zoom_x: typeof zoom.x === "number" ? zoom.x : 0,
      zoom_y: typeof zoom.y === "number" ? zoom.y : 0,
      zoom_k: typeof zoom.k === "number" ? zoom.k : 1,
      positions,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("graph_states")
      .upsert(payload, { onConflict: "page_id" })
      .select("page_id, zoom_x, zoom_y, zoom_k, positions, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      state: {
        pageId: data.page_id,
        zoom: {
          x: data.zoom_x,
          y: data.zoom_y,
          k: data.zoom_k,
        },
        positions: data.positions || {},
        updatedAt: data.updated_at,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to save graph state",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
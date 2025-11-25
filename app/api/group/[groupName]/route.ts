import { NextResponse } from "next/server";
import { loadGroupDashboardData } from "@/lib/core/group-data";

interface RouteContext {
  params: Promise<{ groupName: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupName } = await context.params;
  const decodedGroupName = decodeURIComponent(groupName);

  const data = await loadGroupDashboardData(decodedGroupName, { refreshMode: "always" });

  if (!data) {
    return NextResponse.json(
      { error: "分组不存在或没有配置" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}

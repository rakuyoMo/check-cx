import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { GroupDashboardView } from "@/components/group-dashboard-view";
import { loadGroupDashboardData } from "@/lib/core/group-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface GroupPageProps {
  params: Promise<{ groupName: string }>;
}

// 生成页面元数据
export async function generateMetadata({ params }: GroupPageProps) {
  const { groupName } = await params;
  const decodedGroupName = decodeURIComponent(groupName);

  return {
    title: `${decodedGroupName} - 模型健康面板`,
    description: `查看 ${decodedGroupName} 分组下的模型健康状态`,
  };
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { groupName } = await params;
  const decodedGroupName = decodeURIComponent(groupName);

  const data = await loadGroupDashboardData(decodedGroupName, { refreshMode: "missing" });

  // 分组不存在或没有配置时返回 404
  if (!data) {
    notFound();
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-background via-background to-muted/40 py-10">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 md:px-8">
        {/* 返回首页链接 */}
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-card hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          返回首页
        </Link>

        <GroupDashboardView
          groupName={decodedGroupName}
          initialData={data}
        />
      </main>
    </div>
  );
}

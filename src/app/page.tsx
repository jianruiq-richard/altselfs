import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 text-center sm:mb-12">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-amber-800">
            Altselfs · Decision OS
          </p>
          <h1 className="mb-5 text-4xl font-bold text-slate-950 sm:mb-6 sm:text-6xl">
            每个人的决策 OS
          </h1>
          <p className="mx-auto max-w-3xl text-base leading-8 text-slate-700 sm:text-xl sm:leading-9">
            为高能个体构建一个真正懂你的 AI 决策分身。Altselfs 连接你分散在飞书、Gmail、会议纪要、公众号和 ChatGPT 里的工作 context，帮你筛信号、排优先级、做判断。
          </p>
        </div>

        <div className="grid gap-4 text-left sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-800">跨平台 Context</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              不再反复复制粘贴。你的信息、讨论、待办和反馈会被聚合成可决策的上下文。
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-800">Decision Copilot</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              每天告诉你最重要的 3 件事，给出判断依据，并在边界模糊时请你确认。
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-800">越用越懂你</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              你的每次反馈、批改和选择都会沉淀为个人决策偏好，而不是散落在对话记录里。
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:mt-8 sm:p-10">
          <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
            开始建立你的 AI 决策分身
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
            先从每日晨报、重要事项判断和个人分身配置开始，让系统逐步学习你的工作场景、判断框架和协作偏好。
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="/sign-up?method=phone"
              className="inline-flex justify-center rounded-xl bg-slate-950 px-8 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
            >
              创建我的 Altselfs
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex justify-center rounded-xl border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              已有账号登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

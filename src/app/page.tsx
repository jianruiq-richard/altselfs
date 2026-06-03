import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-[#f5f0e8] text-stone-950">
      <section
        className="relative min-h-[88vh] overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: "url('/office.png')" }}
      >
        <div className="absolute inset-0 bg-[#2a1f18]/35" />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(35,24,17,0.88)_0%,rgba(80,53,35,0.62)_44%,rgba(180,132,82,0.18)_78%,rgba(245,224,190,0.08)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#f5f0e8] via-[#f5f0e8]/20 to-transparent" />

        <div className="relative mx-auto flex min-h-[88vh] w-full max-w-6xl flex-col justify-between px-5 py-6 sm:px-8 sm:py-8">
          <nav className="flex items-center justify-between text-white">
            <Link href="/" className="text-lg font-semibold tracking-wide text-[#fff8ee]">
              Altselfs
            </Link>
            <Link
              href="/sign-in"
              className="rounded-full border border-[#f3d7aa]/35 px-4 py-2 text-sm font-medium text-[#fff8ee]/90 transition-colors hover:bg-[#fff3df]/10"
            >
              登录
            </Link>
          </nav>

          <div className="max-w-3xl pb-8 pt-16 sm:pb-16 sm:pt-28">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.32em] text-[#f4c983]">
              Decision OS for high-agency minds
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-[#fff8ee] sm:text-6xl sm:leading-tight">
              每个人的决策 OS
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#fff0dc]/82 sm:text-xl sm:leading-9">
              Altselfs 为你构建一个真正懂你的 AI 决策分身，连接飞书、Gmail、会议纪要、公众号和 ChatGPT 里的工作 context，帮你筛信号、排优先级、做判断。
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up?method=phone"
                className="inline-flex justify-center rounded-full bg-[#fff4df] px-7 py-3 text-sm font-semibold text-[#2b1a10] shadow-sm transition-colors hover:bg-white"
              >
                创建我的 Altselfs
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex justify-center rounded-full border border-[#f3d7aa]/35 px-7 py-3 text-sm font-semibold text-[#fff8ee] transition-colors hover:bg-[#fff3df]/10"
              >
                已有账号登录
              </Link>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-[#f3d7aa]/20 bg-[#21150f]/58 p-4 text-[#fff8ee] shadow-2xl shadow-black/25 backdrop-blur-md sm:grid-cols-3 sm:p-5">
            <div className="border-t border-[#f3d7aa]/35 pt-4 sm:border-t-0 sm:pt-0">
              <p className="text-sm font-semibold text-[#fffaf2]">跨平台 Context</p>
              <p className="mt-2 text-sm leading-6 text-[#f8e7cc]/82">
                聚合散落在十几个工具里的信息、讨论、待办和反馈。
              </p>
            </div>
            <div className="border-t border-[#f3d7aa]/35 pt-4 sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0">
              <p className="text-sm font-semibold text-[#fffaf2]">Decision Copilot</p>
              <p className="mt-2 text-sm leading-6 text-[#f8e7cc]/82">
                每天给出最重要的 3 件事，以及对应判断依据。
              </p>
            </div>
            <div className="border-t border-[#f3d7aa]/35 pt-4 sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0">
              <p className="text-sm font-semibold text-[#fffaf2]">个人决策偏好</p>
              <p className="mt-2 text-sm leading-6 text-[#f8e7cc]/82">
                每次反馈都会沉淀为你的判断框架，越用越懂你。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f5f0e8] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#9a5a28]">
              Product System
            </p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">
              不是第二个聊天工具，而是你的工作决策层。
            </h2>
            <p className="mt-5 text-base leading-8 text-stone-600">
              Altselfs 不停留在“模仿你说话”。它围绕真实工作 context 建立判断闭环，让 AI 从信息处理走向决策辅助。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[#ded2c2] bg-[#fffaf2] p-5 shadow-sm">
              <p className="text-sm font-semibold text-stone-950">01 · 聚合</p>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                连接工作工具，把碎片信息整理成可追踪的决策 case。
              </p>
            </div>
            <div className="rounded-lg border border-[#ded2c2] bg-[#fffaf2] p-5 shadow-sm">
              <p className="text-sm font-semibold text-stone-950">02 · 判断</p>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                基于你的偏好和历史反馈，给出优先级、风险和行动建议。
              </p>
            </div>
            <div className="rounded-lg border border-[#ded2c2] bg-[#fffaf2] p-5 shadow-sm">
              <p className="text-sm font-semibold text-stone-950">03 · 沉淀</p>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                把批改、采纳和忽略沉淀成个人决策偏好网络。
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

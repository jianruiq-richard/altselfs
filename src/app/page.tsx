import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await currentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="mx-auto max-w-4xl px-4 py-20">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-slate-900 mb-6">OPC平台</h1>
          <p className="mx-auto max-w-3xl text-xl text-slate-700">
            统一的数字分身工作台。让 AI 员工帮你处理信息、沉淀知识、提升协作效率。
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">开始使用 OPC + 数字分身</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">
            注册一个统一 OPC 账户即可开始。后续可在平台内管理你的数字分身与 AI 助手。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up?method=phone"
              className="inline-flex rounded-xl bg-sky-600 px-8 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
            >
              注册 OPC 账户
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex rounded-xl border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              已有账号登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

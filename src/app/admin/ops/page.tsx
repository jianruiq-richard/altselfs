import { redirect } from 'next/navigation';
import { requireOpsAdmin } from '@/lib/ops-auth';
import { getOpsDashboardData, type OpsStatus } from '@/lib/ops-data';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const admin = await requireOpsAdmin();
  if (!admin) redirect('/dashboard');

  const data = await getOpsDashboardData();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8 flex flex-col gap-3 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Altselfs 内部运营</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal">运营监控</h1>
            <p className="mt-2 text-sm text-slate-500">当前登录：{admin.name} · 采集时间 {formatDateTime(data.collectedAt)}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            管理员白名单由 <code>OPS_ADMIN_EMAILS</code> / <code>OPS_ADMIN_CLERK_IDS</code> 控制
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          {data.summary.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-500">{item.label}</p>
                <StatusPill status={item.status} />
              </div>
              <p className="mt-3 text-2xl font-semibold">{item.value}</p>
              {item.detail ? <p className="mt-2 text-sm text-slate-500">{item.detail}</p> : null}
            </div>
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white">
          <SectionTitle title="告警中心" subtitle="低余额、容量高水位和异常用户会在这里汇总。" />
          <div className="divide-y divide-slate-100">
            {data.alerts.length === 0 ? (
              <EmptyRow text="当前没有 warning / critical 告警。" />
            ) : (
              data.alerts.map((alert) => (
                <div key={`${alert.title}-${alert.detail}`} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-medium">{alert.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{alert.detail}</p>
                  </div>
                  <StatusPill status={alert.severity} />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white">
            <SectionTitle title="API Key / 余额" subtitle="真实 key 不展示，只显示指纹和采集状态。" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">服务</th>
                    <th className="px-4 py-3 font-medium">Key</th>
                    <th className="px-4 py-3 font-medium">余额</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.apiAccounts.map((row) => (
                    <tr key={`${row.provider}-${row.account}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.provider}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{row.account}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.note}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.fingerprint}</td>
                      <td className="px-4 py-3">
                        <p>{row.balance}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.usage}</p>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <SectionTitle title="云资源" subtitle="Supabase 分数据库配额和文件存储配额；ECS 分系统盘和工作区盘。" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">资源</th>
                    <th className="px-4 py-3 font-medium">用量</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.resources.map((row) => (
                    <tr key={`${row.provider}-${row.resource}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.provider}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.resource}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{row.used} / {row.total}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.percent === null ? row.note : `${row.percent.toFixed(1)}% · ${row.note || ''}`}</p>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white">
          <SectionTitle title="用户资源使用" subtitle="Token 为估算；数据库按用户相关内容字节估算，ECS 为 Agent workspace 目录实际占用。" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">聊天消息</th>
                  <th className="px-4 py-3 font-medium">Agent 消息</th>
                  <th className="px-4 py-3 font-medium">估算 tokens</th>
                  <th className="px-4 py-3 font-medium">Supabase DB</th>
                  <th className="px-4 py-3 font-medium">Storage</th>
                  <th className="px-4 py-3 font-medium">Agent RDS</th>
                  <th className="px-4 py-3 font-medium">ECS 硬盘</th>
                  <th className="px-4 py-3 font-medium">最近活跃</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((user) => (
                  <tr key={user.userId}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{user.email}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500">{user.userId}</p>
                    </td>
                    <td className="px-4 py-3">{user.role}</td>
                    <td className="px-4 py-3">{user.messages.toLocaleString()} / {user.chats} chats</td>
                    <td className="px-4 py-3">{user.agentMessages.toLocaleString()} / {user.agentThreads} threads</td>
                    <td className="px-4 py-3">{user.estimatedTokens.toLocaleString()}</td>
                    <td className="px-4 py-3">{formatBytes(user.supabaseDbBytes)}</td>
                    <td className="px-4 py-3">{formatBytes(user.supabaseStorageBytes)}</td>
                    <td className="px-4 py-3">{formatBytes(user.agentRdsBytes)}</td>
                    <td className="px-4 py-3">{formatBytes(user.ecsDiskBytes)}</td>
                    <td className="px-4 py-3">{formatDateTime(user.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold">一期说明</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {data.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-4 py-5 text-sm text-slate-500">{text}</div>;
}

function StatusPill({ status }: { status: OpsStatus }) {
  const className = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    critical: 'border-red-200 bg-red-50 text-red-700',
    unknown: 'border-slate-200 bg-slate-100 text-slate-600',
  }[status];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{status}</span>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return '未知';
  if (!Number.isFinite(bytes) || bytes < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { productBrand } from '@/lib/brand';
import { requireOpsAdmin } from '@/lib/ops-auth';
import { getOpsDashboardData, type OpsStatus } from '@/lib/ops-data';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const admin = await requireOpsAdmin();
  if (!admin) redirect('/dashboard');

  const data = await getOpsDashboardData();
  const rapidApiAccounts = data.apiAccounts.filter((row) => row.provider === 'RapidAPI');
  const otherApiAccounts = data.apiAccounts.filter((row) => row.provider !== 'RapidAPI');

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8 flex flex-col gap-3 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{productBrand.name} operations</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal">Ops Dashboard</h1>
            <p className="mt-2 text-sm text-slate-500">Signed in as {admin.name} · Collected {formatDateTime(data.collectedAt)}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/admin/users"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              User Admin
            </Link>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              Access is controlled by <code>OPS_ADMIN_EMAILS</code> / <code>OPS_ADMIN_CLERK_IDS</code>.
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          <SectionTitle title="Alerts" subtitle="Warnings and critical conditions that need attention." />
          <div className="divide-y divide-slate-100">
            {data.alerts.length === 0 ? (
              <EmptyRow text="No warning or critical alerts." />
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

        <section className="mt-6 rounded-lg border border-slate-200 bg-white">
          <SectionTitle
            title="RapidAPI Provider Quotas"
            subtitle="Latest-known limits from each provider's response headers. A successful or failed provider request refreshes that provider's row."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Used</th>
                  <th className="px-4 py-3 font-medium">Remaining</th>
                  <th className="px-4 py-3 font-medium">Plan limit</th>
                  <th className="px-4 py-3 font-medium">Resets at</th>
                  <th className="px-4 py-3 font-medium">Sampled</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rapidApiAccounts.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-5 text-slate-500">No RapidAPI provider data is available.</td></tr>
                ) : (
                  rapidApiAccounts.map((row) => (
                    <tr key={row.account}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{rapidApiSourceName(row.account)}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{row.quota?.host || row.account}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.note}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatInteger(row.quota?.used)}</td>
                      <td className="min-w-36 px-4 py-3 tabular-nums">
                        <p className="font-medium">{formatInteger(row.quota?.remaining)}</p>
                        {row.quota?.usedPercent !== null && row.quota?.usedPercent !== undefined ? (
                          <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100" aria-label={`${row.quota.usedPercent.toFixed(1)}% used`}>
                            <div
                              className="h-full rounded-full bg-slate-500"
                              style={{ width: `${Math.min(100, Math.max(0, row.quota.usedPercent))}%` }}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatInteger(row.quota?.limit)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.quota?.resetAt ? formatDateTime(row.quota.resetAt) : row.quota?.reset || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p>{row.quota?.sampledAt ? formatDateTime(row.quota.sampledAt) : 'Not sampled'}</p>
                        {row.quota?.httpStatus !== null && row.quota?.httpStatus !== undefined ? (
                          <p className="mt-1 text-xs text-slate-500">HTTP {row.quota.httpStatus}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white">
            <SectionTitle title="API Keys / Credits" subtitle="Configured non-RapidAPI keys, balances, and usage status." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Key</th>
                    <th className="px-4 py-3 font-medium">Balance / Usage</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {otherApiAccounts.map((row) => (
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
            <SectionTitle title="Infrastructure Resources" subtitle="Supabase, ECS, RDS, Vercel, and related capacity signals." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Usage</th>
                    <th className="px-4 py-3 font-medium">Status</th>
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

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold">Notes</h2>
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
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function rapidApiSourceName(account: string) {
  return account.split(' · ', 1)[0] || account;
}

function formatInteger(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : 'Unknown';
}

# altselfs 工程资产与复用审阅

审阅时间：2026-10-18。基线 HEAD：`483ec8d3115f83973a74d1917e53d8a6d0f94fc3`，工作区原有 package 文件变更、品牌文件删除及研究输出均保留。

范围包括已跟踪的 Web、组件、库、Prisma、两项服务、脚本、扩展、部署和专家技能代码。全量做文件及结构盘点，对登录、授权、支付、任务、存储、后台和发布关键路径精读，并运行已有测试与类型检查。这不是逐行安全审计，也没有运行生产压测、操作真实账单或验证当前线上配置。

## 1 工程规模与结构

盘点口径为上述目录内已跟踪的 `.ts/.tsx/.js/.mjs/.py/.sh/.sql/.prisma/.yml/.yaml` 文件，包含测试及迁移，不含依赖、构建产物、媒体和未跟踪研究脚本。完整路径见 [source-inventory.csv](source-inventory.csv)。

| 区域 | 源文件数 | 行数 | 主要职责 |
| --- | ---: | ---: | --- |
| Web 页面和 API | 105 | 13,915 | 产品入口、登录、工作台、52 个 API 路由文件 |
| React 组件 | 48 | 19,109 | 聊天、连接器、后台、营销及支付 UI |
| Web 库与 proxy | 59 | 12,001 | 身份、业务访问、集成、分析、路由 |
| personal-agent-server | 106 | 39,997 | Agent 运行、计费、队列、文件、后台、发布控制 |
| semrush-traffic-service | 23 | 3,959 | 浏览器执行、dispatcher、账号配额、串行队列 |
| Prisma | 22 | 1,303 | 23 个业务模型及 21 个 SQL migration |
| 脚本、部署、扩展与技能脚本 | 15 | 3,260 | 运维、研究工具、容器发布和浏览器扩展 |
| 合计 | 378 | 93,544 | 全量结构盘点的范围 |

文件规模不是代码质量评分，但会影响提取：聊天主组件 5,120 行，HTTP server 2,333 行，任务 store 2,288 行，Stripe 模块 1,910 行。它们同时承载多个职责，不宜作为新产品起始文件直接复制。

## 2 当前架构

Web 使用 Next.js、Clerk、Prisma 和 PostgreSQL。用户面对的 API 验证身份后，通过共享内部凭据调用 personal-agent-server；该服务持有 Stripe 能力、积分结算、任务执行、对象存储和运营接口。服务配置分别暴露普通存储、context、billing 数据库 URL，形成多个持久化边界。浏览器自动化独立部署。Web 配置采用 Vercel，后台有 ACR/ECS、蓝绿 gateway 和 drain 脚本。

这些是源码和发布配置支持的架构判断，不能据此确定当前生产机器规格、地区、Stripe live 状态或实际在线容量。

## 3 值得提取的资产

| 能力 | 证据入口 | 提取方式 |
| --- | --- | --- |
| 身份映射与幂等初始化 | [investor-auth.ts](../../src/lib/investor-auth.ts)、[user-provisioning.ts](../../src/lib/user-provisioning.ts) | 保留外部身份到内部用户的映射、upsert 和初始化锁；移除 Investor/Candidate 及默认数据来源耦合 |
| 游客和登录体验 | [auth-modal-provider.tsx](../../src/components/auth-modal-provider.tsx)、[homepage-redirect.ts](../../src/lib/homepage-redirect.ts) | 复用回跳、草稿保留和旧路由处理经验；新产品用常规路由 |
| 数据归属与分页 | [agent-session.ts](../../src/lib/agent-session.ts) | 提取带 owner 约束的数据访问方法，覆盖文件与任务 |
| Stripe 业务生命周期 | [stripe-billing.ts](../../services/personal-agent-server/src/stripe-billing.ts) | 保留 Checkout、Portal、签名校验、续费、退款和拒付设计；产品策略参数化 |
| 积分正确性 | [billing-database.ts](../../services/personal-agent-server/src/billing-database.ts)、[credit-admission.ts](../../services/personal-agent-server/src/credit-admission.ts)、[credit-lots.ts](../../services/personal-agent-server/src/credit-lots.ts)、[credit-settlement.ts](../../services/personal-agent-server/src/credit-settlement.ts) | 可选模块；复用串行化事务、唯一 runId、预留/结算/释放和 FIFO 批次 |
| 持久任务和恢复 | [agent-context-store.ts](../../services/personal-agent-server/src/agent-context-store.ts)、[turn-queue-worker.ts](../../services/personal-agent-server/src/turn-queue-worker.ts) | 保留数据库领取、并发限制、心跳、超时、取消和对账思想；提取普通 Job |
| 直接文件上传 | [artifact-storage.ts](../../services/personal-agent-server/src/artifact-storage.ts)、[artifact-delivery.ts](../../src/lib/artifact-delivery.ts) | 复用私有对象存储、短签名、上传大小限制、HTML 预览限制 |
| 运营后台 | [admin-users-data.ts](../../src/lib/admin-users-data.ts)、[admin-billing.ts](../../services/personal-agent-server/src/admin-billing.ts)、[ops-auth.ts](../../src/lib/ops-auth.ts) | 保留用户、订单、积分、任务排错和带原因的运营操作；补统一审计与禁用状态 |
| 数据驱动验证 | [task-analytics.ts](../../services/personal-agent-server/src/task-analytics.ts)、[analytics](../../src/lib/analytics) | 保留首次任务里程碑、投递 outbox、同意状态和脱敏 |
| 可恢复发布 | [deploy-personal-agent-server.sh](../../infra/aliyun/ecs/deploy-personal-agent-server.sh)、[blue-green-gateway.ts](../../services/personal-agent-server/src/blue-green-gateway.ts) | 保留 standby、activate、drain 和老任务继续执行；增加端到端发布证据 |
| 浏览器池 | [dispatcher.ts](../../services/semrush-traffic-service/src/dispatcher.ts)、[bounded-task-queue.ts](../../services/semrush-traffic-service/src/bounded-task-queue.ts) | 只供明确需要网页自动化的产品，独立资源及账号容量 |

## 4 提取为通用底座前必须解决的边界

以下按新底座的上线风险排序，不代表已证实线上事故。

### 数据及管理权限

- [http-server.ts](../../services/personal-agent-server/src/http-server.ts) 的 `/productization` 和 `/v1/memory-review/jobs` 分支没有与内部管理路由相同的鉴权调用。生产可达性取决于外层网络，应在模板中统一默认拒绝，调试入口仅限内部访问。
- [ops-auth.ts](../../src/lib/ops-auth.ts) 支持管理员 email/id 列表中的 `*`。若误配会扩大权限；生产配置校验应禁止通配符，并优先用稳定身份 id 授权。
- [avatar GET](../../src/app/api/avatar/[id]/route.ts) 对非所有者返回裁剪后的字段，但该分支未按 `isPublic` 拒绝私有对象访问。不能把“裁剪了 systemPrompt”当成资源可见性规则已完成，应明确并验证公开/私人策略。
- [user-provisioning.ts](../../src/lib/user-provisioning.ts) 含按固定模板用户邮箱复制默认来源的业务逻辑。通用模板改用版本化、明确可公开的 seed，不能继承生产用户资料来源。

### 支付和跨系统一致性

- Webhook 已验签，并通过 payment、invoice、ledger 的唯一键防重；但 [registerWebhookEvent](../../services/personal-agent-server/src/stripe-billing.ts) 是“查询状态后 upsert 为 PROCESSING”，不是独占消费租约。已处理幂等不等于处理中并发安全，应补 inbox 领取和并发重放测试。
- `handleStripeWebhook` 在 HTTP 请求中直接处理业务；订阅事件有直接应用传入对象的路径。需要验证乱序事件不会回退权益，避免把事件时间戳当成可靠顺序。
- [persistAgentTurnSuccess](../../services/personal-agent-server/src/agent-context-store.ts) 的消息、状态及 outbox 是多次独立查询；目前有终态检查和最近 24 小时的 outbox backfill。新底座应尽量把业务终态和 outbox 放进同一事务，同时补中途崩溃和迟到 worker 写入测试。
- [personal-agent-internal.ts](../../src/lib/personal-agent-internal.ts) 会重试网络失败。`checkout` 单次 API 请求生成 requestId，可覆盖其内部重试，但浏览器重新发起请求会生成新 id；模板要将稳定购买意图贯穿浏览器、应用和 Stripe。
- 套餐规则分别存在于 [billing-plans.ts](../../src/lib/billing-plans.ts)、`credit-admission.ts`、`admin-billing.ts` 和 `stripe-billing.ts`。模板改为一个服务端目录及显式公开投影，避免 UI、执行权限和账单规则漂移。

### 容量和部署

- [config.ts](../../services/personal-agent-server/src/config.ts) 默认 `AGENT_TURN_MAX_CONCURRENCY=3`、每用户 3、每 thread 1。DB claim 还检查全局 RUNNING/CANCELLING 数，因此增加 worker 副本并不自动按副本数放大可执行容量。这里是代码默认值，不是线上实配。
- Semrush 的单 worker 串行队列和 dispatcher 的内存 Map 不能直接承担通用持久队列承诺。dispatcher 重启恢复必须依赖外层持久任务及安全重试策略；浏览器会话、账户和供应商额度都是独立容量约束。
- [prisma.ts](../../src/lib/prisma.ts) 默认单实例连接上限 1，多个服务有各自 pg Pool。需要总体连接预算与等待指标，不能只把 connection_limit 改成 100。
- [local-acceptance.sh](../../scripts/local-acceptance.sh) 会执行 `prisma db push`，而 smoke 仅将 500 视为失败。它不能用作生产发布及业务成功验收；本次没有运行该脚本。
- [agent-context-store.ts](../../services/personal-agent-server/src/agent-context-store.ts) 在运行路径初始化 SQL schema；新底座改成单独的版本化迁移。
- 发布脚本有明确蓝绿和 drain 机制，但镜像参数允许 `latest`，且本仓库没有已跟踪的 `.github` CI workflow。新模板应固定 digest 并加入可重建流水线、迁移与生产业务核验。现有外部云构建是否另有门禁需单独核查。

### 测试和可维护性

- 根 `package.json` 有 dev/build/start/lint，没有统一 test 入口。Web 测试存在，但发现方式和 CI 门槛需要固化。
- [stripe-billing.test.ts](../../services/personal-agent-server/tests/stripe-billing.test.ts) 只有两个 Portal 配置测试；积分 FIFO 和其他单测有价值，但不证明完整 webhook、真实数据库并发、退款恢复及支付闭环。
- 对本次检索范围，没有找到统一 API 输入 schema、通用限流、完整备份恢复脚本及 100 用户负载验收。供应商限流、应用级准入和边缘平台防护应分别验证，不能互相替代。
- 根 README 存在大量 `Localized documentation` 占位；`CREDITS_BILLING.md` 仍称支付待接入，而源码已有 Stripe 生命周期。部分服务 README 也保留早期阶段说明。模板文档必须由实际能力清单和检查结果驱动。

## 5 本次验证

| 检查 | 结果 |
| --- | --- |
| Web TypeScript，关闭 incremental 写入 | 通过 |
| personal-agent-server TypeScript | 通过 |
| semrush-traffic-service TypeScript | 通过 |
| Web 的 12 个测试文件 | 37/37 通过 |
| personal-agent-server 的 24 个测试文件 | 初次 90/94；3 项本地监听被沙箱拒绝，获得本地端口权限后对应测试通过；1 项断言失败保留 |
| semrush-traffic-service 的 2 个测试文件 | 28/28 通过 |
| 生产构建、真实数据库并发、浏览器 E2E、Stripe Sandbox/live、100 用户压测 | 本次未执行 |

剩余失败是 `tests/rapidapi-youtube-competitor.test.ts:89` 的 `official.count`，期望 2、实际 1；独立重跑可复现。该测试 mock 了 fetch，不能归因为线上供应商故障。本任务保留失败并记录，没有修改无关业务实现来让审阅“变绿”。

排除已经重验通过的环境因素后，159 个不同测试中有 158 个通过、1 个失败。逐项命令和结果见 [validation.txt](validation.txt)。类型检查通过及这些单测结果不构成当前产品达到 100 用户或真实支付可用的证明。

## 6 实施结论

altselfs 最有价值的积累是可运营的完整流程：身份到业务用户、支付到权益、任务到恢复、结果到文件、问题到后台、部署到 drain。新的付费 MVP 底座应保留这些边界与故障处理经验，缩小领域和基础设施数量。

建议先发布一个通过验收的独立 starter，再用一个简单付费产品验证复制过程。后续交付速度来自减少重复决策及重复集成；不能靠减少支付、隔离、恢复和容量验证获得。

# AltSelfs - 投资人数字分身平台

一个让投资人创建AI数字分身来预筛选项目的平台，提高投资效率，让创业者可以与投资人分身对话完善项目。

## 功能特性

### 投资人端
- 🤖 创建和管理数字分身
- ⚙️ 设置投资标准和沟通风格（通过系统提示词）
- 📊 查看所有与分身的对话记录
- 📈 监控项目筛选效果

### 创业者端
- 🔍 浏览所有可用的投资人分身
- 💬 与分身进行实时对话
- 💡 获得个性化的投资建议和反馈
- 🚀 完善项目想法和商业模式

### 技术特性
- ⚡ 基于 Next.js 16+ 的全栈应用
- 🔐 使用 Clerk 进行用户认证
- 🗄️ Prisma + SQLite 数据库（生产环境可切换到 PostgreSQL）
- 🤖 集成 OpenRouter.ai 调用最新的 AI 模型（Claude、GPT-4等）
- 📱 响应式设计，支持移动端

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 环境变量配置

将 `.env.local` 文件中的占位符替换为真实的 API 密钥：

#### Clerk 配置
注册 [Clerk](https://clerk.com) 并获取密钥：

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_你的密钥
CLERK_SECRET_KEY=sk_test_你的密钥
```

#### OpenRouter 配置
注册 [OpenRouter.ai](https://openrouter.ai) 并获取 API 密钥：

```env
OPENROUTER_API_KEY=sk-or-v1-你的密钥
```

### 3. 初始化数据库

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 使用指南

### 投资人操作流程
1. 注册账号并选择"投资人"身份
2. 创建数字分身，设置名称、简介和详细的系统提示词
3. 在控制台查看所有与分身的对话记录
4. 分析对话内容，决定是否与候选人进一步沟通

### 创业者操作流程
1. 注册账号并选择"创业者"身份
2. 在分身广场浏览可用的投资人分身
3. 选择合适的分身开始对话
4. 详细介绍项目，获得投资建议和反馈

## 部署到 Vercel

### 1. 推送到 GitHub
将项目推送到你的 GitHub 仓库。

### 2. 导入 Vercel
在 [Vercel](https://vercel.com) 中导入 GitHub 仓库。

### 3. 环境变量
在 Vercel 项目设置中添加所有环境变量。

### 4. 生产数据库
推荐使用 PostgreSQL，如 [Neon](https://neon.tech) 或 [Supabase](https://supabase.com)。

### 5. 域名配置
添加你购买的域名（如 altselfs.com）。

## 技术栈

- **框架**: Next.js 16 + TypeScript
- **认证**: Clerk
- **数据库**: Prisma + SQLite/PostgreSQL
- **AI**: OpenRouter.ai (Claude 3.5 Sonnet, GPT-4 等)
- **样式**: Tailwind CSS
- **部署**: Vercel

## API 说明

- `POST /api/user/setup` - 用户角色设置
- `GET/POST /api/avatar` - 分身管理
- `GET /api/chat` - 获取/创建聊天会话
- `POST /api/chat/message` - 发送消息获取 AI 回复

## 开发注意事项

1. **系统提示词很重要**: 投资人需要详细描述投资偏好和沟通风格
2. **AI 模型配置**: 默认使用 Claude 3.5 Sonnet，可在 `lib/openrouter.ts` 修改
3. **错误处理**: 所有 API 都有完善的错误处理机制

## 许可证

MIT License

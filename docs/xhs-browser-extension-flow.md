# 小红书助手浏览器扩展授权流程

## 目标

保留“小红书助手”作为 AI agent 对话入口，不再在信息处理运营部门页面里单独做一个小红书管理面板。

当前流程是：

1. 用户在 `altselfs` 工作台点击小红书助手卡片。
2. 页面通过浏览器扩展读取用户当前浏览器里的小红书登录态。
3. `altselfs` 后端把这份登录态保存到当前投资人的 `XIAOHONGSHU` integration。
4. 小红书助手继续复用现有 `Spider_XHS` 技能调用链。

## 关键文件

- 工作台卡片: [src/components/xhs-assistant-card.tsx](/Users/richardjian/work/altselfs/src/components/xhs-assistant-card.tsx:1)
- 小红书对话页: [src/app/investor/chat/[agentId]/page.tsx](/Users/richardjian/work/altselfs/src/app/investor/chat/[agentId]/page.tsx:1)
- 扩展授权入库 API: [src/app/api/investor/xiaohongshu/connector/route.ts](/Users/richardjian/work/altselfs/src/app/api/investor/xiaohongshu/connector/route.ts:1)
- 小红书助手 API: [src/app/api/investor/xiaohongshu/assistant/route.ts](/Users/richardjian/work/altselfs/src/app/api/investor/xiaohongshu/assistant/route.ts:1)
- 浏览器扩展目录: [extensions/xhs-connector/README.md](/Users/richardjian/work/altselfs/extensions/xhs-connector/README.md:1)

## 本地操作步骤

### 1. 启动 `altselfs`

```bash
cd /Users/richardjian/work/altselfs
npm run dev
```

### 2. 加载浏览器扩展

打开 Chrome：

1. 访问 `chrome://extensions`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择目录 `extensions/xhs-connector`

### 3. 浏览器里登录小红书

在同一个 Chrome Profile 里登录：

- `http://localhost:3000`
- `https://www.xiaohongshu.com`

### 4. 在工作台完成授权

进入工作台的小红书助手卡片：

1. 点击“连接浏览器扩展”
2. 扩展读取当前浏览器里的小红书 Cookie
3. 前端把 Cookie 提交给 `/api/investor/xiaohongshu/connector`
4. 后端写入当前用户的 `InvestorIntegration`

### 5. 开始对话

进入：

```text
/investor/chat/xiaohongshu
```

示例问题：

- `帮我搜最近 AI 陪伴赛道的小红书笔记`
- `分析一下最近母婴赛道的爆文方向`
- `给我总结这个笔记链接的核心观点`

## 当前限制

1. 扩展当前按“当前浏览器登录态”工作，不做多小红书账号切换。
2. 扩展目前默认支持 `localhost:3000` 和 `*.vercel.app`。
3. 如果你的正式域名是自定义域名，需要把域名补进扩展的 `manifest.json`。
4. 后端仍然依赖 `Spider_XHS` 运行链路，因此生产环境仍推荐保留远端 Spider 服务。

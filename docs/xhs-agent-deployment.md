# 小红书助手接入 Spider_XHS 部署说明

## 现状

当前小红书助手的会话入口在 [src/app/api/investor/xiaohongshu/assistant/route.ts](/Users/richardjian/work/altselfs/src/app/api/investor/xiaohongshu/assistant/route.ts:151)。

它已经支持两种执行模式：

1. 远端模式：设置 `XHS_SPIDER_ENDPOINT` 后，Next.js 通过 HTTP 调 Spider 服务。
2. 本地模式：未设置 `XHS_SPIDER_ENDPOINT` 时，Next.js 用 `python3 scripts/xhs_spider_bridge.py` 直接调用本地 `Spider_XHS`。

桥接脚本在 [scripts/xhs_spider_bridge.py](/Users/richardjian/work/altselfs/scripts/xhs_spider_bridge.py:82)，当前封装了三个动作：

- `search_notes`
- `get_note_detail`
- `get_user_notes`

底层实际调用的是 `Spider_XHS` 里的：

- `XHS_Apis.search_some_note`
- `XHS_Apis.get_note_info`
- `XHS_Apis.get_user_all_notes`

## 推荐部署拓扑

生产环境推荐拆成两部分：

1. `altselfs` 继续部署在 Vercel，负责 UI、会话编排、LLM 规划与总结。
2. `Spider_XHS` 独立部署成一个 Python HTTP 服务，负责真正的小红书抓取。

原因：

- 当前 Vercel 配置把 API 函数限制在 30 秒内，见 [vercel.json](/Users/richardjian/work/altselfs/vercel.json:1)。
- `Spider_XHS` 依赖 Python + Node.js + `execjs` + 本地 JS 签名文件，不适合塞进 Vercel 的 Next.js Route Handler 里直接起子进程。
- 当前本地模式默认读取 `external_solutions/Spider_XHS`，只适合开发机，不适合线上。

## 环境变量

在 `altselfs` 中补充以下环境变量：

```env
# 小红书 Spider 远端服务地址
XHS_SPIDER_ENDPOINT=https://your-xhs-spider-service.example.com/xhs

# 远端服务共享密钥，推荐开启
XHS_SPIDER_SECRET=replace-with-a-long-random-secret

# 可选：全局 Cookie。如果你希望所有投资人共用同一个小红书登录态
XHS_COOKIES=

# 仅本地开发时使用：Spider_XHS 实际目录
XHS_SPIDER_ROOT=/Users/richardjian/work/Spider_XHS
```

## 本地开发接法

如果你要先在本机把链路跑通，最简单的做法有两种。

方式 A：用环境变量指向你的真实目录。

```env
XHS_SPIDER_ROOT=/Users/richardjian/work/Spider_XHS
```

方式 B：保持默认目录约定，做一个软链接。

```bash
mkdir -p /Users/richardjian/work/altselfs/external_solutions
ln -s /Users/richardjian/work/Spider_XHS /Users/richardjian/work/altselfs/external_solutions/Spider_XHS
```

然后安装依赖：

```bash
cd /Users/richardjian/work/Spider_XHS
pip install -r requirements.txt
npm install
```

再启动 `altselfs`：

```bash
cd /Users/richardjian/work/altselfs
npm install
npm run dev
```

## 远端 Spider 服务最小接口

`altselfs` 发给远端服务的请求体格式固定为：

```json
{
  "action": "search_notes",
  "args": {
    "query": "母婴",
    "limit": 10
  },
  "cookies": "a1=...; web_session=..."
}
```

返回格式建议与本地桥接脚本保持一致：

```json
{
  "ok": true,
  "message": "success",
  "action": "search_notes",
  "items": []
}
```

## 远端 Spider 服务建议实现

建议你在 `Spider_XHS` 仓库里新增一个轻量 HTTP 包装层，职责只有三件事：

1. 校验 `Authorization: Bearer <XHS_SPIDER_SECRET>`。
2. 把 `action/args/cookies` 映射到 `XHS_Apis`。
3. 返回和本地桥接脚本相同的 JSON 结构。

服务必须至少支持：

- `search_notes`
- `get_note_detail`
- `get_user_notes`

## 推荐部署位置

优先级如下：

1. 云服务器 / Docker Compose / Railway / Fly.io / Render 这类能稳定跑 Python 常驻服务的平台。
2. 你自己的容器平台。
3. 不建议把 `Spider_XHS` 直接塞进 Vercel 的 Next.js API。

## 调试顺序

推荐按这个顺序排障：

1. 先独立验证 `Spider_XHS` 能搜到内容。
2. 再验证远端服务 API 的 JSON 入参和出参。
3. 最后在 `altselfs` 里走完整会话链路。

用户侧成功标志：

1. 小红书助手对话中输入“帮我搜最近的 AI 陪伴类笔记”。
2. planner 产出 `search_notes`。
3. Spider 返回 `items`。
4. 最终回答里出现“3 条结论 + 证据 + 可执行动作”。

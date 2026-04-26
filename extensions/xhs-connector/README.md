# AltSelfs XiaoHongShu Connector

这个扩展只做一件事：帮助 `altselfs` 在用户明确点击授权后，读取当前浏览器里的小红书登录态，并交给站内的小红书助手使用。

## 本地加载

1. 打开 Chrome 的 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录 `extensions/xhs-connector`

## 本地调试

当前允许注入的站点：

- `http://localhost:3000/*`
- `https://*.vercel.app/*`

如果你的正式域名不是 `vercel.app`，需要把域名加入 [manifest.json](/Users/richardjian/work/altselfs/extensions/xhs-connector/manifest.json:1) 的 `host_permissions` 和 `content_scripts.matches`。

当前默认会尝试读取这些小红书域名下的 Cookie：

- `https://xiaohongshu.com/*`
- `https://*.xiaohongshu.com/*`

## 使用方式

1. 在同一个浏览器里登录小红书
2. 登录 `altselfs`
3. 打开工作台里的“小红书助手”卡片，或进入 `/investor/chat/xiaohongshu`
4. 点击“连接浏览器扩展”

如果授权失败，可以点击页面里的“运行诊断”，查看扩展当前实际读到的 Cookie 名称和域名分布。

如果你刚修改或重新加载了扩展，记得在 `chrome://extensions` 里点一次刷新，然后把 `altselfs` 页面也刷新一次。

## 当前能力

- 检测扩展是否安装
- 读取当前浏览器的小红书 Cookie
- 尝试读取当前账号昵称

## 后续建议

- 增加“授权过期提醒”
- 增加“自动刷新授权”
- 增加“只同步必要 Cookie”的精细化策略

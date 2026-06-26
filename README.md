## Agently Mail 是什么？

简单说就是：**给你的 AI Agent 一个专属的 QQ 邮箱**，跟你自己的个人邮箱完全隔离，让 Agent 可以像真人一样收发邮件。

核心能力：

- **微信扫码授权**，不用记密码，授权后 Agent 拿到独立邮箱地址
- **收发/回复/转发/搜索/附件管理** 全套邮件操作
- **两阶段确认**：发邮件前 Agent 先生成摘要让你确认，确认后才真正发送——不会手滑
- **Prompt 注入防护**：邮件正文里的"指令"不会被执行，防恶意邮件操控 Agent
- **与个人邮箱完全隔离**，权限最小化，隐私无忧

安装三步走：

```bash
npm install -g @tencent-qqmail/agently-cli
npx skills add Tencent/AgentlyMail -g -y
agently-cli auth login   # 终端输出授权链接，微信扫码即可
```

---

## 官网版 Skill 遇到的问题

玩了几天发现官网版有几个比较难受的坑：

### 1. HTML 邮件排版错乱

发带表格、样式、图片的 HTML 邮件时，收件方经常收到残缺的正文——表格被截断、内联 CSS 丢失、排版完全乱掉。

### 2. Windows PowerShell 转义符地狱

根源在于 Windows 上通过 PowerShell 调用 `agently-cli message +send --body "<html>..."` 时，`cmd.exe` / PowerShell 的参数解析机制会把 HTML 内容里的分号 `;`、逗号 `,`、双引号 `"` 处截断，导致传过去的 HTML 已经残缺了。试过 PowerShell Here-String 、Base64 编码、文件重定向各种方案，在不同 Windows 版本上行为还不一样，非常玄学。

### 3. macOS / Linux 下同样有细微差异

官网版在不同平台下跑起来体验不一致。

---

## 优化版 Skill

地址： https://download-cs3.mingting.cn/cs3/pivotclaw/skills/lib/qq-agently-mail.zip

可以让 Agent 自行安装，直接覆盖更新。

### 改了什么？

核心思路是用 Node.js `spawnSync` + `process.execPath` 直接调用 agently-cli 的 JS 入口，argv 直传 `--body` 参数，**彻底绕过 shell/PowerShell 的参数解析层**。

```
[PowerShell/Shell] --(node mail-helper.mjs)--> [Node.js]
                                                   |
                                           spawnSync(process.execPath, [run.js, --body, <html>])
                                                   |
                                                   ▼
                                           agently-cli JS 入口 (run.js)
                                                   |
                                                   ▼
                                           QQ Mail API (POST)
```

具体改动：

| 项目          | 官网版                  | 优化版                                          |
| ------------- | ----------------------- | ----------------------------------------------- |
| HTML 发送方式 | PowerShell 直接调用 CLI | Node.js spawnSync 直传，绕过 shell              |
| 跨平台一致性  | Windows 下易出问题      | Windows / macOS / Linux 三平台一致              |
| 表格支持      | 经常排版错乱            | 完整支持，内联 CSS 正常渲染                     |
| 嵌入图片      | `cid:` 引用不稳定     | 通过`--body-file` + `--attachment` 稳定支持 |
| 长 HTML       | 易截断                  | `--body-file` 模式从文件读取，无长度限制      |

### 使用方式

Agent 发送 HTML 邮件时统一走 `mail-helper.mjs`：

```bash
# 推荐：写 HTML 文件 + --body-file 模式（跨平台，最稳定）
node <skill 路径>/assets/mail-helper.mjs \
  --to alice@example.com \
  --subject "项目周报" \
  --body-format html \
  --body-file ./report.html

# 短 HTML 也可以直接用 --body 内联
node <skill 路径>/assets/mail-helper.mjs \
  --to alice@example.com \
  --subject "通知" \
  --body-format html \
  --body '<h2 style="color:#333;">通知</h2><p>会议改期</p>'
```

邮件里的表格、图片、样式都能正常渲染，再也不会出现排版乱掉的情况了。

---

## 内测信息

目前 Agently Mail 在内测阶段，**每个人可以申请 2 个邮箱地址，前缀可自定义**（比如 `my-bot@agently.qq.com`）。

申请方式：去 https://agent.qq.com/ 微信扫码登录，按引导操作即可，目前免费使用。

---

## 总结

Agently Mail 解决了 Agent 收发邮件的刚需，跟个人邮箱隔离 + 两阶段确认的设计也很靠谱。官网版在日常纯文本邮件场景完全够用，但如果你的 Agent 需要发带格式、表格、图片的 HTML 邮件（比如自动生成周报、数据报表），建议试试优化版 Skill ，省去折腾 PowerShe

ll 转义符的功夫。

有问题欢迎交流，也期待官方后续把 HTML 邮件这块原生优化好。

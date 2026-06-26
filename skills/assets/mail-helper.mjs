#!/usr/bin/env node

/**
 * qq-agently-mail HTML 邮件助手 — 跨平台（Windows / Linux / macOS）
 *
 * ===== 解决的问题 =====
 *
 * agently-cli 的 --body 参数接收 HTML 字符串。
 * PowerShell 在传递含逗号和分号的 HTML 字符串时（如内联 CSS），
 * 字符串会被截断，导致邮件正文残缺。
 *
 * 解法：用 Node.js 直接调用 agently-cli 的 JS 入口文件，
 * 通过 child_process.spawnSync 的 argv 传入 --body，
 * 完全绕过 shell/PowerShell 的参数解析层。
 *
 * ===== 与 SKILL.md 调用示例的对应关系 =====
 *
 * 所有需要发送 HTML 邮件的场景，将：
 *   agently-cli message +send --body $body ...
 *
 * 替换为：
 *   node <helper-path> --body-file tmp_mail.html ...
 *
 * 其中 tmp_mail.html 由 Python/其他语言写为 UTF-8 文件。
 *
 * ===== Agent 用法（Windows PowerShell） =====
 *
 *  # 第 1 步：用 Python 写 HTML 文件（避免 PowerShell 字符串截断）
 *  uv run python3 -c "
 *  import os
 *  html = '''<!DOCTYPE html>...'''
 *  with open('tmp_mail.html', 'w', encoding='utf-8') as f: f.write(html)
 *  print('Written', os.path.getsize('tmp_mail.html'), 'bytes')
 *  "
 *
 *  # 第 2 步（第一阶段 — 获取确认令牌）
 *  node <helper-path> ^
 *    --to xxx@qq.com ^
 *    --subject \"主题\" ^
 *    --body-format html ^
 *    --body-file tmp_mail.html
 *
 *  # 成功后拿到 ctk_xxx，展示 summary，停下等用户确认
 *
 *  # 第 3 步（第二阶段 — 确发送）
 *  node <helper-path> ^
 *    --to xxx@qq.com ^
 *    --subject \"主题\" ^
 *    --body-format html ^
 *    --body-file tmp_mail.html ^
 *    --confirmation-token ctk_xxx
 *
 *  # 清理
 *  Remove-Item tmp_mail.html -Force
 *
 * ===== Agent 用法（Linux / macOS Bash） =====
 *
 *  # 第 1 步
 *  cat > tmp_mail.html << 'HTMLEOF'
 *  <!DOCTYPE html>...
 *  HTMLEOF
 *
 *  # 第 2 步
 *  node <helper-path> \
 *    --to xxx@qq.com \
 *    --subject "主题" \
 *    --body-format html \
 *    --body-file tmp_mail.html
 *
 *  # 第 3 步
 *  node <helper-path> \
 *    --to xxx@qq.com \
 *    --subject "主题" \
 *    --body-format html \
 *    --body-file tmp_mail.html \
 *    --confirmation-token ctk_xxx
 *
 *  # 清理
 *  rm tmp_mail.html
 *
 * ===== 重要实现细节 =====
 *
 * 为什么不直接用 agently-cli 的 .cmd / shell wrapper？
 *   Windows 上 npm 安装的 agently-cli 入口是 .cmd 批处理文件，
 *   它不能直接被 child_process.spawn 执行（需 shell:true），
 *   且 cmd.exe 的参解析会破坏含 HTML 的 --body 内容。
 *
 * 为什么不用 pipe stdin？
 *   agently-cli 不支持从 stdin 读取 --body，只能通过 --body 参数传入。
 *
 * 直接调用 JS 入口文件的优势：
 *   - 三平台完全一致：node <script> [args]
 *   - 参数通过 Node.js 的 uv_spawn 直传，无 shell 干扰
 *   - 所有字符（中文、emoji、特殊符号）完整保留
 */

import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function die(msg, code) {
  process.stderr.write(JSON.stringify({ ok: false, error: { message: msg } }) + '\n');
  process.exit(code);
}

/**
 * 找到 agently-cli 的 JS 入口文件（run.js）。
 *
 * 策略：
 *   1. 通过 `which`/`where` 找 agently-cli 可执行文件
 *   2. 如果是 .cmd/shell wrapper，推导同目录下 node_modules 中的 run.js
 *   3. 如果找不到，尝试常见 npm global 安装位置
 */
function resolveAgentlyEntry() {
  // Method 1: Check common npm global paths for the actual Node.js entry
  const candidates = [];

  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    // npm global install path
    candidates.push(
      resolve(home, 'AppData', 'Roaming', 'npm', 'node_modules', '@tencent-qqmail', 'agently-cli', 'scripts', 'run.js'),
      resolve(localAppData, 'npm', 'node_modules', '@tencent-qqmail', 'agently-cli', 'scripts', 'run.js'),
    );
  } else {
    const home = process.env.HOME || '';
    candidates.push(
      '/usr/local/lib/node_modules/@tencent-qqmail/agently-cli/scripts/run.js',
      resolve(home, '.npm-global', 'lib', 'node_modules', '@tencent-qqmail', 'agently-cli', 'scripts', 'run.js'),
    );
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Method 2: Try which/where and derive the script path
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(whichCmd, ['agently-cli'], { shell: true, encoding: 'utf-8', timeout: 3000 });
    if (r.status === 0) {
      const paths = r.stdout.trim().split('\n').map(s => s.trim()).filter(Boolean);
      if (paths.length > 0) {
        const wrapperPath = paths[0];
        const wrapperDir = dirname(wrapperPath);
        // Derive: .../npm/agently-cli(.cmd) → .../npm/node_modules/@tencent-qqmail/agently-cli/scripts/run.js
        const derived = resolve(wrapperDir, 'node_modules', '@tencent-qqmail', 'agently-cli', 'scripts', 'run.js');
        if (existsSync(derived)) return derived;
      }
    }
  } catch {}

  // Method 3: Try resolving from npm prefix
  try {
    const r = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf-8', timeout: 5000 });
    if (r.status === 0) {
      const prefix = r.stdout.trim();
      const derived = resolve(prefix, 'node_modules', '@tencent-qqmail', 'agently-cli', 'scripts', 'run.js');
      if (existsSync(derived)) return derived;
    }
  } catch {}

  die(
    'Cannot find agently-cli entry script. Ensure it is installed: npm install -g @tencent-qqmail/agently-cli',
    3
  );
}

function main() {
  const args = process.argv.slice(2);
  const agArgs = [];
  let bodyFile = null;
  let bodyInline = null;

  // Parse and categorize arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--body-file' && i + 1 < args.length) {
      bodyFile = args[++i];
    } else if (args[i] === '--body' && i + 1 < args.length) {
      const next = args[i + 1];
      if (next && !next.startsWith('--') && next.length > 0) {
        bodyInline = args[++i];
      } else {
        agArgs.push(args[i]);
      }
    } else {
      agArgs.push(args[i]);
    }
  }

  // Determine body content
  let bodyContent;
  if (bodyFile) {
    try {
      bodyContent = readFileSync(resolve(bodyFile), 'utf-8');
    } catch (err) {
      die(`Cannot read body file "${bodyFile}": ${err.message}`, 2);
    }
  } else if (bodyInline !== null) {
    bodyContent = bodyInline;
  }

  const entryScript = resolveAgentlyEntry();

  if (bodyContent !== undefined) {
    // With body: build args with --body
    const finalArgs = [entryScript, 'message', '+send', ...agArgs, '--body', bodyContent];
    const proc = spawnSync(process.execPath, finalArgs, {
      shell: false,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });

    if (proc.error) {
      die(`Failed to run agently-cli: ${proc.error.message}`, 4);
    }
    if (proc.stdout) process.stdout.write(proc.stdout);
    if (proc.stderr) process.stderr.write(proc.stderr);
    process.exit(proc.status ?? 1);
  }

  // Pass-through: no body override, forward as-is
  const finalArgs = [entryScript, 'message', '+send', ...args];
  const proc = spawnSync(process.execPath, finalArgs, {
    shell: false,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });

  if (proc.error) {
    die(`Failed to run agently-cli: ${proc.error.message}`, 4);
  }
  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);
  process.exit(proc.status ?? 1);
}

main();

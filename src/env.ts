/**
 * .env loader — 无依赖的 .env 文件读取
 * 自动从 process.cwd() 加载 .env 文件
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 加载 .env 文件到 process.env
 * 不会覆盖已有的环境变量
 */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 解析 KEY=VALUE
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // 去掉引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 不覆盖已存在的环境变量
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

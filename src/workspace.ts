import { readFile, writeFile, mkdir, readdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Workspace — 文件系统操作层
 * 替代 PetGPT 的 Tauri workspace 命令。所有操作相对于 socialDir。
 */
export class Workspace {
  constructor(private rootDir: string) {}

  /** 获取文件的绝对路径 */
  private resolve(filePath: string): string {
    // 如果已经是绝对路径，直接使用
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.rootDir, filePath);
  }

  /** 确保目录存在 */
  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(this.resolve(filePath));
    await mkdir(dir, { recursive: true });
  }

  /** 读取文本文件，不存在返回 null */
  async read(filePath: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(filePath), 'utf-8');
    } catch {
      return null;
    }
  }

  /** 写入文本文件（自动创建目录） */
  async write(filePath: string, content: string): Promise<void> {
    await this.ensureDir(filePath);
    await writeFile(this.resolve(filePath), content, 'utf-8');
  }

  /** 追加到文本文件（自动创建目录） */
  async append(filePath: string, content: string): Promise<void> {
    await this.ensureDir(filePath);
    await writeFile(this.resolve(filePath), content, { flag: 'a', encoding: 'utf-8' });
  }

  /** 编辑文件：精确替换文本 */
  async edit(filePath: string, oldText: string, newText: string): Promise<boolean> {
    const content = await this.read(filePath);
    if (content === null || !content.includes(oldText)) return false;
    await this.write(filePath, content.replace(oldText, newText));
    return true;
  }

  /** 列出目录下的条目 */
  async list(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(this.resolve(dirPath), { withFileTypes: true });
      return entries.map(e => e.name);
    } catch {
      return [];
    }
  }

  /** 删除文件 */
  async delete(filePath: string): Promise<boolean> {
    try {
      await unlink(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /** 重命名/移动文件 */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    try {
      await rename(this.resolve(oldPath), this.resolve(newPath));
      return true;
    } catch {
      return false;
    }
  }

  /** 检查文件是否存在 */
  exists(filePath: string): boolean {
    return existsSync(this.resolve(filePath));
  }
}

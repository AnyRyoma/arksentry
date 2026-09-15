#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import ignore from 'ignore';
import { analyzeFiles, createHandoff, toMarkdown, type SourceFileInput } from '@arksentry/core';

const BUILT_IN_IGNORES = new Set(['node_modules', 'oh_modules', 'build', '.preview']);
const TEST_PATHS = new Set(['src/test', 'src/ohosTest']);

interface ParsedArgs {
  command: 'scan' | 'handoff';
  directory?: string;
  changed: boolean;
  format: 'text' | 'markdown' | 'json';
}

function usage(): string {
  return `ArkSentry — 本地 ArkTS AI 代码验收\n\n用法：\n  arksentry scan <directory> [--format markdown|json]\n  arksentry scan --changed [--format markdown|json]\n  arksentry handoff --changed\n\n说明：所有扫描和任务包均在本地生成，ArkSentry 不上传、不写回代码。`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandToken = 'scan', ...rest] = argv;
  if (commandToken !== 'scan' && commandToken !== 'handoff') throw new Error(usage());
  let directory: string | undefined;
  let changed = false;
  let format: ParsedArgs['format'] = 'text';
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--changed') changed = true;
    else if (value === '--format') {
      const next = rest[index + 1];
      if (next !== 'markdown' && next !== 'json' && next !== 'text') throw new Error('--format 只支持 text、markdown 或 json。');
      format = next;
      index += 1;
    } else if (value.startsWith('--format=')) {
      const next = value.slice('--format='.length);
      if (next !== 'markdown' && next !== 'json' && next !== 'text') throw new Error('--format 只支持 text、markdown 或 json。');
      format = next;
    } else if (!value.startsWith('-') && !directory) directory = value;
    else throw new Error(`无法识别参数：${value}`);
  }
  if (changed && directory) throw new Error('目录扫描与 --changed 不能同时使用。');
  if (!changed && !directory) directory = process.cwd();
  if (commandToken === 'handoff' && !changed) throw new Error('handoff 当前只支持 --changed，确保任务包只覆盖本次 Git 改动。');
  return { command: commandToken, directory, changed, format };
}

function isIgnored(root: string, absolutePath: string, gitIgnore: ReturnType<typeof ignore>): boolean {
  const relativePath = relative(root, absolutePath).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('..')) return true;
  const segments = relativePath.split('/');
  if (segments.some((segment) => BUILT_IN_IGNORES.has(segment))) return true;
  if ([...TEST_PATHS].some((testPath) => relativePath === testPath || relativePath.startsWith(`${testPath}/`))) return true;
  return gitIgnore.ignores(relativePath);
}

function gitIgnoreFor(root: string): ReturnType<typeof ignore> {
  const matcher = ignore();
  const path = resolve(root, '.gitignore');
  if (existsSync(path)) matcher.add(readFileSync(path, 'utf8'));
  return matcher;
}

function collectDirectory(root: string): SourceFileInput[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`目录不存在：${root}`);
  const matcher = gitIgnoreFor(root);
  const inputs: SourceFileInput[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (isIgnored(root, fullPath, matcher)) continue;
      if (entry.isDirectory()) walk(fullPath);
      if (entry.isFile() && entry.name.endsWith('.ets')) {
        const size = statSync(fullPath).size;
        if (size <= 1024 * 1024) {
          inputs.push({ path: relative(root, fullPath).split(sep).join('/'), content: readFileSync(fullPath, 'utf8') });
        }
      }
    }
  };
  walk(root);
  if (inputs.length > 500) {
    throw new Error(`候选 .ets 文件为 ${inputs.length} 个，超过 500 个安全上限。请缩小扫描目录。`);
  }
  return inputs;
}

function git(rootArg?: string): string {
  try {
    return execFileSync('git', ['-C', rootArg ?? process.cwd(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('当前目录不是 Git 工作区，无法执行 --changed。请使用 arksentry scan <directory>。');
  }
}

function gitLines(root: string, args: string[]): string[] {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function collectChanged(rootArg?: string): SourceFileInput[] {
  const root = git(rootArg);
  const candidates = new Set<string>([
    ...gitLines(root, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...gitLines(root, ['diff', '--name-only', '--diff-filter=ACMR']),
    ...gitLines(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
    ...gitLines(root, ['ls-files', '--others', '--exclude-standard'])
  ]);
  const matcher = gitIgnoreFor(root);
  const inputs: SourceFileInput[] = [];
  for (const filePath of candidates) {
    if (!filePath.endsWith('.ets')) continue;
    const absolutePath = resolve(root, filePath);
    if (!existsSync(absolutePath) || isIgnored(root, absolutePath, matcher)) continue;
    const size = statSync(absolutePath).size;
    if (size > 1024 * 1024) continue;
    inputs.push({ path: filePath.split(sep).join('/'), content: readFileSync(absolutePath, 'utf8') });
  }
  return inputs;
}

function printReport(report: ReturnType<typeof analyzeFiles>, format: ParsedArgs['format']): void {
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else console.log(toMarkdown(report));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const inputs = args.changed ? collectChanged() : collectDirectory(resolve(args.directory ?? process.cwd()));
  const report = analyzeFiles(inputs);
  if (args.command === 'handoff') console.log(createHandoff(report));
  else printReport(report, args.format);
  process.exitCode = report.blockerCount > 0 ? 2 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

import * as ts from 'typescript';

export type Severity = 'blocker' | 'warning';

export interface SourceFileInput {
  path: string;
  content: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  path: string;
  line: number;
  column: number;
  snippet: string;
  reason: string;
  suggestion: string;
  reference: string;
}

export interface FileAnalysis {
  path: string;
  findings: Finding[];
  analysisError?: string;
}

export interface AnalysisReport {
  files: FileAnalysis[];
  scannedFiles: number;
  unanalyzedFiles: number;
  blockerCount: number;
  warningCount: number;
  generatedAt: string;
}

interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  reason: string;
  suggestion: string;
}

const REFERENCE = 'https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V13/arkts-coding-style-guide-V13';

const RULES: Record<string, RuleMeta> = {
  'ARK-001': {
    id: 'ARK-001', title: '禁止使用 any', severity: 'blocker',
    reason: 'any 会绕过 ArkTS 的静态类型约束，使 AI 生成代码的风险无法被追踪。',
    suggestion: '为值声明明确模型，或先解析为命名的数据结构后再使用。'
  },
  'ARK-002': {
    id: 'ARK-002', title: '禁止使用 unknown', severity: 'blocker',
    reason: '该项目策略不允许 unknown 作为绕开建模的过渡类型。',
    suggestion: '定义可验证的接口或类，并在边界处完成字段校验。'
  },
  'ARK-003': {
    id: 'ARK-003', title: '禁止使用 ESObject', severity: 'blocker',
    reason: 'ESObject 会丢失 ArkTS 所需的静态类型信息。',
    suggestion: '改用具名类或明确的接口模型。'
  },
  'ARK-004': {
    id: 'ARK-004', title: '禁止受限工具类型', severity: 'blocker',
    reason: 'Record、Partial、Pick、Omit、ReturnType 会隐藏字段约束或推导边界。',
    suggestion: '声明完整的具名模型或显式字段集合。'
  },
  'ARK-005': {
    id: 'ARK-005', title: '禁止类型位置 typeof', severity: 'blocker',
    reason: '类型位置的 typeof 不符合本项目的 ArkTS 类型策略。',
    suggestion: '抽取一个具名类型，避免从运行时值反推类型。'
  },
  'ARK-006': {
    id: 'ARK-006', title: '禁止非空断言与 as const', severity: 'blocker',
    reason: '非空断言和 as const 会掩盖空值与可变性风险。',
    suggestion: '先做显式空值分支，并使用具名只读模型表达约束。'
  },
  'ARK-007': {
    id: 'ARK-007', title: '禁止动态属性访问', severity: 'blocker',
    reason: 'obj[key] 的字段来源在编译期不可验证。',
    suggestion: '把输入复制到具名模型字段，或使用明确的分支访问。'
  },
  'ARK-008': {
    id: 'ARK-008', title: '禁止 for...in、delete 与 in', severity: 'blocker',
    reason: '这些动态对象操作不符合本项目的 ArkTS 安全约束。',
    suggestion: '使用受控数组遍历、显式字段判断或创建新的模型对象。'
  },
  'ARK-009': {
    id: 'ARK-009', title: '禁止 Object.entries 与 Object.is', severity: 'blocker',
    reason: '这两个 Object API 不在本项目允许的 ArkTS 用法中。',
    suggestion: '使用显式字段访问和常规相等比较表达业务意图。'
  },
  'ARK-010': {
    id: 'ARK-010', title: '禁止动态 import()', severity: 'blocker',
    reason: '动态模块加载会削弱工程依赖与构建分析。',
    suggestion: '改用静态 import，并在模块边界处做依赖注入。'
  },
  'ARK-011': {
    id: 'ARK-011', title: '禁止 ArkUI V1/V2 状态管理混用', severity: 'blocker',
    reason: '同一组件混用 V1 与 V2 状态管理会造成生命周期和数据流不一致。',
    suggestion: '将组件完整迁移到 V2，统一使用 @ComponentV2 与 V2 状态装饰器。'
  },
  'ARK-012': {
    id: 'ARK-012', title: 'Kit 导入必须使用 @kit.*', severity: 'blocker',
    reason: '本项目策略要求 Kit API 通过 @kit.* 导入，避免旧式模块引用。',
    suggestion: '核实目标 API 的公开导出后，改用对应的 @kit.* 路径。'
  }
};

function lineSnippet(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim().slice(0, 240);
}

function positionOf(source: ts.SourceFile, pos: number): { line: number; column: number } {
  const location = source.getLineAndCharacterOfPosition(pos);
  return { line: location.line + 1, column: location.character + 1 };
}

function addFinding(
  findings: Finding[],
  source: ts.SourceFile,
  input: SourceFileInput,
  ruleId: string,
  pos: number
): void {
  const rule = RULES[ruleId];
  const location = positionOf(source, pos);
  const existing = findings.some((finding) =>
    finding.ruleId === ruleId && finding.line === location.line && finding.column === location.column
  );
  if (existing) return;
  findings.push({
    ruleId,
    title: rule.title,
    severity: rule.severity,
    path: input.path,
    line: location.line,
    column: location.column,
    snippet: lineSnippet(input.content, location.line),
    reason: rule.reason,
    suggestion: rule.suggestion,
    reference: REFERENCE
  });
}

function scanV1V2(source: ts.SourceFile, input: SourceFileInput, findings: Finding[]): void {
  const v1Pattern = /@(State|Prop|Link|Provide|Consume|Observed|ObjectLink|Watch|StorageLink|StorageProp)\b/;
  const v2Pattern = /@(ComponentV2|Local|Param|Event|Provider|Consumer|ObservedV2|Trace|Monitor|Computed|AppStorageV2|PersistenceV2)\b/;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const start = node.getFullStart();
      const componentText = input.content.slice(start, node.getEnd());
      const v1 = v1Pattern.exec(componentText);
      const v2 = v2Pattern.exec(componentText);
      if (v1 && v2) addFinding(findings, source, input, 'ARK-011', start + Math.min(v1.index, v2.index));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export function analyzeFile(input: SourceFileInput): FileAnalysis {
  // ArkTS uses `struct`, while TypeScript's parser expects `class`. The replacement
  // keeps every character position stable, so locations still point at original code.
  const parserContent = input.content.replace(/\bstruct\b/g, 'class ');
  const source = ts.createSourceFile(input.path, parserContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: Finding[] = [];

  const parseDiagnostics = (source as never as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
    if (parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return { path: input.path, findings, analysisError: `语法解析失败：${message}` };
  }

  const visit = (node: ts.Node): void => {
    const start = node.getStart(source);
    if (node.kind === ts.SyntaxKind.AnyKeyword) addFinding(findings, source, input, 'ARK-001', start);
    if (node.kind === ts.SyntaxKind.UnknownKeyword) addFinding(findings, source, input, 'ARK-002', start);
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(source).split('.').pop() ?? '';
      if (name === 'ESObject') addFinding(findings, source, input, 'ARK-003', start);
      if (['Record', 'Partial', 'Pick', 'Omit', 'ReturnType'].includes(name)) {
        addFinding(findings, source, input, 'ARK-004', start);
      }
    }
    if (ts.isTypeQueryNode(node)) addFinding(findings, source, input, 'ARK-005', start);
    if (ts.isNonNullExpression(node) || (ts.isAsExpression(node) && /\s+as\s+const\b/.test(node.getText(source)))) {
      addFinding(findings, source, input, 'ARK-006', start);
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression &&
      !ts.isStringLiteral(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression)) {
      addFinding(findings, source, input, 'ARK-007', start);
    }
    if (ts.isForInStatement(node) || ts.isDeleteExpression(node) ||
      (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword)) {
      addFinding(findings, source, input, 'ARK-008', start);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Object' &&
      (node.name.text === 'entries' || node.name.text === 'is')) {
      addFinding(findings, source, input, 'ARK-009', start);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addFinding(findings, source, input, 'ARK-010', start);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('@ohos.')) {
      addFinding(findings, source, input, 'ARK-012', start);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  scanV1V2(source, input, findings);
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  return { path: input.path, findings };
}

export function analyzeFiles(inputs: SourceFileInput[]): AnalysisReport {
  const files = inputs.map(analyzeFile);
  const allFindings = files.flatMap((file) => file.findings);
  return {
    files,
    scannedFiles: files.length,
    unanalyzedFiles: files.filter((file) => file.analysisError).length,
    blockerCount: allFindings.filter((finding) => finding.severity === 'blocker').length,
    warningCount: allFindings.filter((finding) => finding.severity === 'warning').length,
    generatedAt: new Date().toISOString()
  };
}

export function toMarkdown(report: AnalysisReport): string {
  const lines = [
    '# ArkSentry 本地验收报告',
    '',
    `- 已扫描文件：${report.scannedFiles}`,
    `- 无法完整分析：${report.unanalyzedFiles}`,
    `- 阻断项：${report.blockerCount}`,
    `- 警告项：${report.warningCount}`,
    '',
    '> 本报告是本地规则验收结果，不等同于编译通过、运行通过或官方认证。',
    ''
  ];
  for (const file of report.files) {
    lines.push(`## ${file.path}`);
    if (file.analysisError) lines.push(`- 无法完整分析：${file.analysisError}`);
    if (file.findings.length === 0 && !file.analysisError) lines.push('- 未命中当前规则集。');
    for (const finding of file.findings) {
      lines.push(`- **${finding.ruleId}｜${finding.title}**（${finding.line}:${finding.column}）`);
      lines.push(`  - 原因：${finding.reason}`);
      lines.push(`  - 建议：${finding.suggestion}`);
      lines.push(`  - 片段：\`${finding.snippet.replace(/`/g, '\\`')}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function createHandoff(report: AnalysisReport): string {
  const affected = report.files.filter((file) => file.findings.length > 0);
  const lines = [
    '请仅修复以下 ArkTS 文件中列出的规则问题。',
    '约束：保持现有业务行为；只改列出的文件；不要扩大重构；不要引入 any、unknown、ESObject、受限工具类型或动态属性访问。',
    '输出：按文件给出最小 unified diff，并简要说明每项修复如何满足规则。',
    ''
  ];
  for (const file of affected) {
    lines.push(`文件：${file.path}`);
    for (const finding of file.findings) {
      lines.push(`- ${finding.ruleId}（${finding.line}:${finding.column}）：${finding.reason}`);
      lines.push(`  当前片段：${finding.snippet}`);
      lines.push(`  修复方向：${finding.suggestion}`);
    }
    lines.push('');
  }
  if (affected.length === 0) lines.push('当前报告没有需要交给 AI 修复的规则命中。');
  return lines.join('\n');
}

export const ruleCatalog = Object.values(RULES).map((rule) => ({ ...rule, reference: REFERENCE }));

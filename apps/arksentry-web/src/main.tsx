import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  analyzeFiles,
  createHandoff,
  toMarkdown,
  type AnalysisReport,
  type SourceFileInput
} from '@arksentry/core';
import './styles.css';

const IGNORED_SEGMENTS = new Set(['node_modules', 'oh_modules', 'build', '.preview']);
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_FILES = 500;
const ANALYSIS_BATCH_SIZE = 4;

type LocalFileHandle = { kind: 'file'; name: string; getFile(): Promise<File> };
type LocalDirectoryHandle = { kind: 'directory'; name: string; values(): AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle> };
type DirectoryWindow = Window & { showDirectoryPicker?: () => Promise<LocalDirectoryHandle> };

const demos: Record<string, SourceFileInput[]> = {
  'ai-mistakes': [{
    path: 'entry/src/main/ets/pages/GeneratedPage.ets',
    content: `import router from '@ohos.router';
@Component
struct GeneratedPage {
  @State title: any = 'AI draft';
  build() {
    Text(this.title!)
  }
}
@ComponentV2
struct NewPage {
  @Local payload: unknown = '';
  build() { Object.entries(payload); }
}`
  }],
  'state-mix': [{
    path: 'entry/src/main/ets/pages/StateMix.ets',
    content: `@ComponentV2
struct StateMix {
  @State count: number = 0;
  @Local title: string = 'mixed';
  build() { Text(this.title); }
}`
  }],
  clean: [{
    path: 'entry/src/main/ets/models/Profile.ets',
    content: `export class Profile {
  name: string = '';
  level: number = 0;
}`
  }]
};

function shouldSkip(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment)) ||
    normalized.includes('/src/test/') || normalized.includes('/src/ohosTest/');
}

async function readFiles(files: File[]): Promise<SourceFileInput[]> {
  const candidates = files
    .filter((file) => file.name.endsWith('.ets'))
    .filter((file) => file.size <= MAX_FILE_SIZE)
    .filter((file) => !shouldSkip(file.webkitRelativePath || file.name));
  if (candidates.length > MAX_FILES) throw new Error(`检测到 ${candidates.length} 个候选 .ets 文件。为避免浏览器卡顿，请选择更小的目录。`);
  return Promise.all(candidates.map(async (file) => ({
    path: file.webkitRelativePath || file.name,
    content: await file.text()
  })));
}

async function readHandle(handle: LocalDirectoryHandle, prefix = ''): Promise<SourceFileInput[]> {
  const inputs: SourceFileInput[] = [];
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (shouldSkip(path)) continue;
    if (entry.kind === 'directory') {
      inputs.push(...await readHandle(entry, path));
    } else if (entry.kind === 'file' && entry.name.endsWith('.ets')) {
      const file = await entry.getFile();
      if (file.size <= MAX_FILE_SIZE) inputs.push({ path, content: await file.text() });
    }
    if (inputs.length > MAX_FILES) throw new Error(`检测到超过 ${MAX_FILES} 个候选 .ets 文件。请缩小目录范围。`);
  }
  return inputs;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function mergeReports(reports: AnalysisReport[]): AnalysisReport {
  const merged: AnalysisReport = {
    files: [],
    scannedFiles: 0,
    unanalyzedFiles: 0,
    blockerCount: 0,
    warningCount: 0,
    generatedAt: new Date().toISOString()
  };
  for (const report of reports) {
    merged.files.push(...report.files);
    merged.scannedFiles += report.scannedFiles;
    merged.unanalyzedFiles += report.unanalyzedFiles;
    merged.blockerCount += report.blockerCount;
    merged.warningCount += report.warningCount;
  }
  return merged;
}

function App() {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [message, setMessage] = useState('选择本地项目目录，或先体验内置示例。');
  const [busy, setBusy] = useState(false);

  const reportMarkdown = useMemo(() => report ? toMarkdown(report) : '', [report]);
  useEffect(() => {
    pickerRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const run = async (nextInputs: SourceFileInput[]): Promise<void> => {
    setBusy(true);
    setReport(null);
    try {
      if (nextInputs.length === 0) {
        setMessage('没有找到可扫描的 .ets 文件。');
        return;
      }
      const partialReports: AnalysisReport[] = [];
      for (let index = 0; index < nextInputs.length; index += ANALYSIS_BATCH_SIZE) {
        const end = Math.min(index + ANALYSIS_BATCH_SIZE, nextInputs.length);
        setMessage(`正在本地分析 ${end} / ${nextInputs.length} 个文件（源码未上传）…`);
        await yieldToBrowser();
        partialReports.push(analyzeFiles(nextInputs.slice(index, end)));
      }
      setReport(mergeReports(partialReports));
      setMessage(`已在本地扫描 ${nextInputs.length} 个文件；页面仅保留报告，不保留完整源码副本。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '本地分析失败。');
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = async (): Promise<void> => {
    const picker = (window as DirectoryWindow).showDirectoryPicker;
    if (!picker) {
      pickerRef.current?.click();
      return;
    }
    try {
      const directory = await picker();
      setBusy(true);
      setMessage('正在本机读取所选目录，仅筛选 .ets 文件…');
      await run(await readHandle(directory, directory.name));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : '读取目录失败。');
    } finally {
      setBusy(false);
    }
  };

  const onFallbackPick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    setBusy(true);
    setMessage('正在本机读取所选目录，仅筛选 .ets 文件…');
    try {
      await run(await readFiles(Array.from(event.target.files ?? [])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取目录失败。');
    } finally {
      event.target.value = '';
      setBusy(false);
    }
  };

  const copy = async (value: string, success: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setMessage('复制失败。请在安全上下文（HTTPS 或 localhost）中重试。');
    }
  };

  return <main>
    <header className="hero">
      <p className="eyebrow">LOCAL-ONLY · ARKTS · AI CODING</p>
      <h1>ArkSentry</h1>
      <p className="subtitle">把 AI 改动后的 ArkTS 项目，变成一份可验证、可交接的验收报告。</p>
    </header>

    <section className="privacy-card" role="note" aria-label="源码隐私保护说明">
      <div className="privacy-badge" aria-hidden="true">✓</div>
      <div>
        <strong>源码不会离开你的设备</strong>
        <p>扫描完全在当前浏览器内完成。ArkSentry 不上传、不保存源码，也不调用任何模型或第三方分析服务。</p>
        <ul className="privacy-points">
          <li>仅读取你主动选择的目录</li>
          <li>只处理 .ets 文件</li>
          <li>刷新页面即清空本次报告</li>
        </ul>
      </div>
    </section>

    <section className="actions" aria-label="项目扫描操作">
      <button className="primary" onClick={chooseDirectory} disabled={busy}>{busy ? '正在本机处理…' : '选择本地项目（仅本机读取）'}</button>
      <input ref={pickerRef} className="visually-hidden" type="file" multiple onChange={onFallbackPick} />
      <span>或体验：</span>
      <button disabled={busy} onClick={() => void run(demos['ai-mistakes'])}>AI 常见踩坑</button>
      <button disabled={busy} onClick={() => void run(demos['state-mix'])}>V1/V2 混用</button>
      <button disabled={busy} onClick={() => void run(demos.clean)}>通过样例</button>
    </section>

    <p className="status" role="status" aria-live="polite">{message}</p>

    {report && <>
      <section className="summary" aria-label="验收概览">
        <article><strong>{report.scannedFiles}</strong><span>已扫描文件</span></article>
        <article className="danger"><strong>{report.blockerCount}</strong><span>阻断项</span></article>
        <article><strong>{report.warningCount}</strong><span>警告项</span></article>
        <article><strong>{report.unanalyzedFiles}</strong><span>无法完整分析</span></article>
      </section>
      <section className="notice">这是本地规则验收结果，不等同于编译通过、运行通过或官方认证。</section>
      <section className="privacy-reminder">隐私提示：报告只保留规则命中与必要代码片段；完整源码不会写入浏览器存储，刷新页面后本次结果即清空。</section>
      <section className="report-actions">
        <button onClick={() => copy(createHandoff(report), '已复制 AI 修复任务包。')}>生成并复制 AI 修复任务包</button>
        <button onClick={() => copy(reportMarkdown, '已复制 Markdown 验收报告。')}>复制 Markdown 报告</button>
      </section>
      <section className="files">
        {report.files.map((file) => <article className="file-card" key={file.path}>
          <h2>{file.path}</h2>
          {file.analysisError && <p className="parse-error">{file.analysisError}</p>}
          {file.findings.length === 0 && !file.analysisError && <p className="pass">未命中当前规则集。</p>}
          {file.findings.map((finding) => <details key={`${finding.ruleId}-${finding.line}-${finding.column}`}>
            <summary><span className="tag">{finding.ruleId}</span> {finding.title} <em>{finding.line}:{finding.column}</em></summary>
            <p><b>原因：</b>{finding.reason}</p>
            <p><b>修复方向：</b>{finding.suggestion}</p>
            <pre><code>{finding.snippet}</code></pre>
            <a href={finding.reference} target="_blank" rel="noreferrer">查看规则参考</a>
          </details>)}
        </article>)}
      </section>
    </>}
    <footer>已在使用 Git？仅验收本次改动，并生成可交给 AI 的修复任务包。 <a href="https://github.com/AnyRyoma/arksentry/tree/main/apps/arksentry-cli" target="_blank" rel="noreferrer">了解 CLI 工作流 →</a></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);

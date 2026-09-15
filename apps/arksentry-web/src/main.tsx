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

  return <main id="top">
    <nav className="topbar" aria-label="主导航">
      <a className="brand" href="#top" aria-label="ArkSentry 首页">
        <span className="brand-mark">AS</span>
        <span><b>ArkSentry</b><small>ARKTS ACCEPTANCE</small></span>
      </a>
      <div className="topbar-actions">
        <span className="local-status"><i />LOCAL ONLY</span>
        <a className="repo-link" href="https://github.com/AnyRyoma/arksentry" target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </nav>

    <header className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><span>01</span> AI 代码的最后一道本地防线</p>
        <h1><span>AI 改代码，</span><em>你掌握验收权。</em></h1>
        <p className="subtitle">面向 ArkTS 工程的项目级验收工具：找出高频约束问题，定位到文件与行号，再把最小修复任务精准交回 AI。</p>
        <div className="hero-metrics" aria-label="产品能力概览">
          <div><strong>12</strong><span>高频规则</span></div>
          <div><strong>0 B</strong><span>源码上传</span></div>
          <div><strong>1×</strong><span>项目选择</span></div>
        </div>
      </div>
      <aside className="pipeline" aria-label="ArkSentry 验收流程">
        <div className="pipeline-head"><span>ACCEPTANCE_PIPELINE</span><i>READY</i></div>
        <ol>
          <li><b>01</b><div><strong>选择项目</strong><small>只读取你授权的 .ets 文件</small></div><span>PICK</span></li>
          <li><b>02</b><div><strong>本地验收</strong><small>按文件聚合规则与行号</small></div><span>SCAN</span></li>
          <li><b>03</b><div><strong>精准交接</strong><small>生成最小 diff 修复任务包</small></div><span>HANDOFF</span></li>
        </ol>
        <div className="command-line"><span>$</span> arksentry scan --changed<i>_</i></div>
      </aside>
    </header>

    <section className="privacy-card" role="note" aria-label="源码隐私保护说明">
      <div className="privacy-badge" aria-hidden="true">✓</div>
      <div className="privacy-copy">
        <span className="privacy-kicker">LOCAL PROCESSING GUARANTEE</span>
        <strong>源码不会离开你的设备</strong>
        <p>扫描完全在当前浏览器内完成。ArkSentry 不上传、不保存源码，也不调用任何模型或第三方分析服务。</p>
      </div>
      <ul className="privacy-points">
        <li><b>01</b> 仅读取主动选择的目录</li>
        <li><b>02</b> 只处理 .ets 文件</li>
        <li><b>03</b> 刷新页面即清空报告</li>
      </ul>
    </section>

    <section className="scan-panel" aria-labelledby="scan-title">
      <div className="section-heading">
        <div><span className="section-index">02 / START</span><h2 id="scan-title">开始本地验收</h2></div>
        <span className="scope-chip">.ETS ONLY</span>
      </div>
      <div className="primary-action">
        <button className="primary" onClick={chooseDirectory} disabled={busy}>
          <span>{busy ? '正在本机处理…' : '选择本地项目'}</span>
          <small>仅本机读取，不上传源码 →</small>
        </button>
        <input ref={pickerRef} className="visually-hidden" type="file" multiple onChange={onFallbackPick} />
        <p>Chrome / Edge 支持直接选择目录；其他浏览器会自动降级为目录文件选择。</p>
      </div>
      <div className="demo-section">
        <p className="demo-label">没有 ArkTS 项目？用内置场景快速体验</p>
        <div className="demo-grid">
          <button disabled={busy} onClick={() => void run(demos['ai-mistakes'])}><span>01</span><b>AI 常见踩坑</b><small>5 个典型命中</small></button>
          <button disabled={busy} onClick={() => void run(demos['state-mix'])}><span>02</span><b>V1 / V2 混用</b><small>状态管理冲突</small></button>
          <button disabled={busy} onClick={() => void run(demos.clean)}><span>03</span><b>通过样例</b><small>查看零命中结果</small></button>
        </div>
      </div>
    </section>

    <p className={busy ? 'status busy' : 'status'} role="status" aria-live="polite"><span />{message}</p>

    {report && <section className="results" aria-labelledby="results-title">
      <div className="section-heading results-heading">
        <div><span className="section-index">03 / REPORT</span><h2 id="results-title">验收结果</h2></div>
        <span className="report-time">LOCAL REPORT</span>
      </div>
      <section className="summary" aria-label="验收概览">
        <article><small>SCANNED</small><strong>{report.scannedFiles}</strong><span>已扫描文件</span></article>
        <article className="danger"><small>BLOCKERS</small><strong>{report.blockerCount}</strong><span>阻断项</span></article>
        <article><small>WARNINGS</small><strong>{report.warningCount}</strong><span>警告项</span></article>
        <article><small>UNANALYZED</small><strong>{report.unanalyzedFiles}</strong><span>无法完整分析</span></article>
      </section>
      <div className="result-notices">
        <section className="notice"><b>结果边界</b><span>这是本地规则验收结果，不等同于编译通过、运行通过或官方认证。</span></section>
        <section className="privacy-reminder"><b>隐私状态</b><span>仅保留规则命中与必要片段；完整源码不写入浏览器存储。</span></section>
      </div>
      <section className="report-actions">
        <button className="action-primary" onClick={() => copy(createHandoff(report), '已复制 AI 修复任务包。')}>生成并复制 AI 修复任务包 <span>→</span></button>
        <button onClick={() => copy(reportMarkdown, '已复制 Markdown 验收报告。')}>复制 Markdown 报告</button>
      </section>
      <section className="files">
        {report.files.map((file) => <article className="file-card" key={file.path}>
          <div className="file-head"><span>ETS</span><h3>{file.path}</h3></div>
          {file.analysisError && <p className="parse-error">{file.analysisError}</p>}
          {file.findings.length === 0 && !file.analysisError && <p className="pass">✓ 未命中当前规则集。</p>}
          {file.findings.map((finding) => <details key={`${finding.ruleId}-${finding.line}-${finding.column}`}>
            <summary><span className="tag">{finding.ruleId}</span><b>{finding.title}</b><em>{finding.line}:{finding.column}</em></summary>
            <div className="finding-body">
              <p><b>原因</b>{finding.reason}</p>
              <p><b>修复方向</b>{finding.suggestion}</p>
              <pre><code>{finding.snippet}</code></pre>
              <a href={finding.reference} target="_blank" rel="noreferrer">查看规则参考 ↗</a>
            </div>
          </details>)}
        </article>)}
      </section>
    </section>}

    <footer>
      <div><span className="brand-mark footer-mark">AS</span><p><b>把 AI 生成速度，变成可控的工程效率。</b><small>MIT 开源 · 本地优先 · 不替代官方编译验证</small></p></div>
      <p>已在使用 Git？仅验收本次改动，并生成可交给 AI 的修复任务包。 <a href="https://github.com/AnyRyoma/arksentry/tree/main/apps/arksentry-cli" target="_blank" rel="noreferrer">了解 CLI 工作流 →</a></p>
    </footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);

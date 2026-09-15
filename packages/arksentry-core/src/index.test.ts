import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFiles, createHandoff, toMarkdown } from './index.js';

const allRuleSample = `
import feature from '@ohos.feature';
@ComponentV2
struct BrokenPage {
  @State count: any = 0;
  @State legacyCount: number = 0;
  @Local name: unknown = '';
  value: ESObject;
  build() {
    type MapType = Record<string, string>;
    type ValueType = typeof count;
    const ready = this.value!;
    const kinds = [] as const;
    const entry = ready[key];
    for (const key in ready) { delete ready[key]; }
    const found = 'name' in ready;
    Object.entries(ready); Object.is(found, true); import('./lazy');
  }
}
`;

test('finds all 12 first-release rules', () => {
  const report = analyzeFiles([{ path: 'entry/src/main/ets/Broken.ets', content: allRuleSample }]);
  const ids = new Set(report.files[0].findings.map((finding) => finding.ruleId));
  for (let index = 1; index <= 12; index += 1) {
    assert.ok(ids.has(`ARK-${String(index).padStart(3, '0')}`));
  }
  assert.equal(report.unanalyzedFiles, 0);
});

test('does not report a typed, static file', () => {
  const report = analyzeFiles([{ path: 'entry/src/main/ets/Safe.ets', content: 'class Model { name: string = \'\'; }' }]);
  assert.equal(report.blockerCount, 0);
  assert.match(toMarkdown(report), /未命中当前规则集/);
  assert.match(createHandoff(report), /没有需要交给 AI 修复/);
});

test('keeps other files when one file cannot be parsed', () => {
  const report = analyzeFiles([
    { path: 'Broken.ets', content: 'class {' },
    { path: 'Typed.ets', content: 'const value: any = 1;' }
  ]);
  assert.equal(report.unanalyzedFiles, 1);
  assert.equal(report.blockerCount, 1);
});

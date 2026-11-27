import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown as ClaudeMarkdown } from '../../src/renderer/components/Markdown';
import { Markdown as ChatgptMarkdown } from '../../src/renderer-chatgpt/components/Markdown';
import { normalizeMathMarkdown } from '../../../packages/embedded-chat/src/math';

for (const [style, Component] of [['claude', ClaudeMarkdown], ['chatgpt', ChatgptMarkdown]] as const) {
  const render = (text: string, streaming = false) => renderToStaticMarkup(createElement(Component, { text, streaming }));
  describe(style + ' math rendering', () => {
    it('renders dollar and backslash inline math, with fractions and subscripts', () => {
      const html = render(String.raw`Inline $x_i^2$ and \(\frac{a+b}{c}\) with **bold**.`);
      expect((html.match(/class="katex"/g) ?? [])).toHaveLength(2);
      expect(render(String.raw`\(\text{Price: \$5}\)`)).not.toContain('katex-display');
      expect(html).toContain('<math'); expect(html).toContain('mfrac'); expect(html).toContain('<strong>bold</strong>');
    });
    it('renders display equations, aligned rows, matrices and single-line double-dollar math', () => {
      const html = render(String.raw`\[
\begin{aligned}y &= x^2 \\ z &= \sum_{i=1}^{n} i\end{aligned}
\]

$$
A = \begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
$$

$$E = mc^2$$`);
      expect((html.match(/class="katex-display"/g) ?? [])).toHaveLength(3);
      expect(html).not.toContain('katex-error');
    });
    it('keeps code, literal brackets, escaped delimiters and currency readable', () => {
      const html = render(String.raw`Use \`$x$ and \(x\)\` literally. Pay \$5 and \$10, or $5 and $10.

\`\`\`tex
\[x^2\]
\`\`\`

[reference](https://example.com)`.replaceAll('\\`', '`'));
      expect(html).not.toContain('class="katex"'); expect(html).toContain('$5 and $10');
      expect(html).toContain('<code>$x$'); expect(html).toContain('language-tex'); expect(html).toContain('https://example.com');
    });
    it('renders completed math during streaming and survives unfinished or unsupported TeX', () => {
      expect(render(String.raw`\(x^2\)`, true)).toContain('class="katex"');
      expect(() => render(String.raw`$$
\frac{1}{
$$`, true)).not.toThrow();
      expect(render(String.raw`\(\unsupportedCommand{x}\)`)).toContain('unsupportedCommand');
      expect(render(String.raw`Still writing \(\frac{1}{`, true)).not.toContain('class="katex"');
    });
    it('does not enable raw HTML, untrusted math links, styles or remote images', () => {
      const html = render(String.raw`<script>alert(1)</script>

\(\href{javascript:alert(1)}{click}\) \(\includegraphics{https://example.com/track.png}\)`);
      expect(html).toContain('class="katex"');
      expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('<img');
    });
  });
}
it('normalizes only prose while retaining quote/list indentation and dollar math contents', () => {
  expect(normalizeMathMarkdown(String.raw`> \[x_i^2\]`)).toBe('> $$\n> x_i^2\n> $$');
  expect(normalizeMathMarkdown(String.raw`- \[x_i^2\]`)).toBe('- $$\n  x_i^2\n  $$');
  const code = '`\\(literal\\)`\n\n    \\[literal\\]\n\n$\\text{\\(literal\\)}$';
  expect(normalizeMathMarkdown(code)).toBe(code);
  expect(normalizeMathMarkdown(String.raw`\\(literal\\)`)).toBe(String.raw`\\(literal\\)`);
});

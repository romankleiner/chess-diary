import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderProse } from '@/components/blog-shared';

function render(text: string): string {
  return renderToStaticMarkup(<>{renderProse(text)}</>);
}

describe('renderProse', () => {
  it('wraps a single line in one <p>', () => {
    const html = render('Just one line.');
    expect(html).toBe('<p class="">Just one line.</p>');
  });

  it('splits double newlines into separate paragraphs', () => {
    const html = render('First para.\n\nSecond para.');
    expect(html).toBe('<p class="">First para.</p><p class="">Second para.</p>');
  });

  it('preserves single newlines as <br> within a paragraph', () => {
    const html = render('Line one\nLine two');
    expect(html).toBe('<p class="">Line one<br/>Line two</p>');
  });

  it('handles a mix of blank lines and single line breaks', () => {
    const html = render('A\nB\n\nC');
    expect(html).toContain('<p class="">A<br/>B</p>');
    expect(html).toContain('<p class="">C</p>');
  });

  it('renders **bold** within a line', () => {
    const html = render('Hello **world**!');
    expect(html).toBe('<p class="">Hello <strong>world</strong>!</p>');
  });

  it('threading: bold across line breaks in the same paragraph', () => {
    const html = render('**What went well:** Solid prep.\nGood time use.');
    expect(html).toContain('<strong>What went well:</strong>');
    expect(html).toContain('<br/>');
  });

  it('collapses 3+ blank lines to a single paragraph break', () => {
    const html = render('A\n\n\n\nB');
    expect(html).toBe('<p class="">A</p><p class="">B</p>');
  });

  it('applies an optional paragraphClass to each <p>', () => {
    const html = renderToStaticMarkup(<>{renderProse('A\n\nB', 'foo bar')}</>);
    expect(html).toBe('<p class="foo bar">A</p><p class="foo bar">B</p>');
  });
});

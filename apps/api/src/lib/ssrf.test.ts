import { describe, expect, it } from 'vitest';
import { assertSafeUrl, parseHtmlMetadata } from './ssrf';

describe('SSRF prevention', () => {
  it('allows public https URLs', () => {
    expect(assertSafeUrl('https://example.com/page').hostname).toBe('example.com');
  });

  it('blocks localhost', () => {
    expect(() => assertSafeUrl('http://localhost/admin')).toThrow();
    expect(() => assertSafeUrl('http://127.0.0.1/')).toThrow();
  });

  it('blocks private IPs', () => {
    expect(() => assertSafeUrl('http://10.0.0.5/')).toThrow();
    expect(() => assertSafeUrl('http://192.168.1.1/')).toThrow();
    expect(() => assertSafeUrl('http://172.16.0.2/')).toThrow();
  });

  it('blocks non-http schemes', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow();
    expect(() => assertSafeUrl('ftp://example.com')).toThrow();
  });
});

describe('HTML metadata parsing', () => {
  it('extracts title description and image', () => {
    const html = `
      <html><head>
        <title>Hello &amp; World</title>
        <meta property="og:description" content="A page" />
        <meta property="og:image" content="/img.png" />
        <link rel="icon" href="/favicon.ico" />
      </head></html>
    `;
    const meta = parseHtmlMetadata(html, 'https://example.com/x');
    expect(meta.title).toBe('Hello & World');
    expect(meta.description).toBe('A page');
    expect(meta.image).toBe('https://example.com/img.png');
    expect(meta.favicon).toBe('https://example.com/favicon.ico');
    expect(meta.domain).toBe('example.com');
  });
});

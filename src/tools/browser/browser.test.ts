import { describe, test, expect } from 'bun:test';
import { assertNavigableUrl } from './browser.js';

// `page.goto()` used to receive the model-supplied URL unchecked, so
// `file:///…/.env` read any local file straight into the LLM context, bypassing
// the filesystem sandbox, and internal hosts were reachable from a page the
// agent was told to visit by untrusted content.
describe('assertNavigableUrl', () => {
  test('allows public http and https URLs', async () => {
    await expect(assertNavigableUrl('https://example.com/page')).resolves.toBeUndefined();
    await expect(assertNavigableUrl('http://example.com')).resolves.toBeUndefined();
  });

  test('rejects non-http schemes', async () => {
    for (const url of [
      'file:///Users/alex/.env',
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'chrome://settings',
      'view-source:https://example.com',
      'ftp://example.com/x',
    ]) {
      await expect(assertNavigableUrl(url)).rejects.toThrow(/Blocked URL scheme/);
    }
  });

  test('rejects malformed URLs', async () => {
    await expect(assertNavigableUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  test('rejects loopback and local hostnames', async () => {
    for (const url of ['http://localhost:11434', 'http://foo.local', 'http://svc.internal']) {
      await expect(assertNavigableUrl(url)).rejects.toThrow(/Blocked host/);
    }
  });

  test('rejects literal private and link-local addresses', async () => {
    for (const url of [
      'http://127.0.0.1:8080',
      'http://10.0.0.5',
      'http://192.168.1.1',
      'http://172.16.0.1',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.64.0.1', // CGNAT
      'http://[::1]/',
      'http://[fd00::1]/',
    ]) {
      await expect(assertNavigableUrl(url)).rejects.toThrow(/Blocked host/);
    }
  });

  test('allows public literal addresses', async () => {
    await expect(assertNavigableUrl('http://1.1.1.1')).resolves.toBeUndefined();
    await expect(assertNavigableUrl('http://172.32.0.1')).resolves.toBeUndefined();
  });
});

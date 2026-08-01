import { DynamicStructuredTool } from '@langchain/core/tools';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium, Browser, Page } from 'playwright';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { logger } from '@/utils';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/**
 * True for loopback, private, link-local, CGNAT and unique-local addresses —
 * the destinations an agent driven by untrusted page content must not reach.
 */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded v4 address.
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return false;
}

/**
 * Validate a URL the model asked the browser to load.
 *
 * Rejects non-http(s) schemes — `file://` would otherwise read any local file
 * straight into the LLM context, bypassing the filesystem sandbox — and
 * destinations on the loopback or private networks.
 *
 * @throws Error if the URL is not safe to navigate to
 */
export async function assertNavigableUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Blocked URL scheme '${parsed.protocol}': only http and https are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new Error(`Blocked host '${parsed.hostname}': local and internal hosts are not allowed`);
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Blocked host '${parsed.hostname}': private and loopback addresses are not allowed`);
    }
    return;
  }

  // Resolve so a public name pointing at an internal address is caught too.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve host '${parsed.hostname}'`);
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`Blocked host '${parsed.hostname}': resolves to a private address`);
  }
}

/**
 * Apply the same URL policy to every request the page makes, so in-page
 * redirects and subresources cannot reach what `assertNavigableUrl` blocks.
 */
async function installUrlGuard(target: Page): Promise<void> {
  await target.route('**/*', async (route) => {
    try {
      await assertNavigableUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
}

let browser: Browser | null = null;
let page: Page | null = null;

// Store refs from the last snapshot for action resolution
let currentRefs: Map<string, { role: string; name?: string; nth?: number }> = new Map();

// Type for Playwright's _snapshotForAI result
interface SnapshotForAIResult {
  full?: string;
}

// Extended Page type with _snapshotForAI method
interface PageWithSnapshotForAI extends Page {
  _snapshotForAI?: (opts: { timeout: number; track: string }) => Promise<SnapshotForAIResult>;
}

/**
 * Rich description for the browser tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const BROWSER_DESCRIPTION = `
Control a web browser to navigate websites and extract information.

**NOTE: For simply reading a web page's content, prefer web_fetch which returns content directly in a single call. Use browser only for interactive tasks requiring JavaScript rendering, clicking, or form filling.**

## When to Use

- Accessing dynamic/JavaScript-rendered content that requires a real browser
- Multi-step web navigation (click links, fill search boxes)
- Interacting with SPAs or pages that require JavaScript to load content
- When web_fetch fails or returns incomplete content due to JS-dependent rendering

## When NOT to Use

- Reading static web pages or articles (use **web_fetch** instead - it is faster and returns content in a single call)
- Simple queries that web_search can already answer
- Structured financial data (use get_financials instead)
- SEC filings content (use read_filings instead)
- General knowledge questions

## CRITICAL: Navigate Returns NO Content

The \`navigate\` action only loads the page - it does NOT return page content.
You MUST call \`snapshot\` after navigate to see what's on the page.

## CRITICAL: Use Visible URLs - Do NOT Guess

When the snapshot shows a link with a URL (e.g., \`/url: https://...\`):
1. **Option A**: Click the link using its ref (e.g., act with kind="click", ref="e22")
2. **Option B**: Navigate directly to the URL shown in the snapshot

**NEVER make up or guess URLs based on common patterns**. If you need to reach a page:
1. Take a snapshot
2. Find the link in the snapshot
3. Either click it OR navigate to its visible /url value

Bad: Guessing https://company.com/news-events/press-releases
Good: Using the /url value you SEE in the snapshot

## Available Actions

- **navigate** - Navigate to a URL in the current tab (returns only url/title, no content)
- **open** - Open a URL in a NEW tab (use when starting a fresh browsing session)
- **snapshot** - See page structure with clickable refs (e.g., e1, e2, e3)
- **act** - Interact with elements using refs (click, type, press, scroll)
- **read** - Extract full text content from the page
- **close** - Free browser resources when done

## Workflow (MUST FOLLOW)

1. **navigate** or **open** - Load a URL (returns only url/title, no content)
2. **snapshot** - See page structure with clickable refs (e.g., e1, e2, e3)
3. **act** - Interact with elements using refs:
   - kind="click", ref="e5" - Click a link/button
   - kind="type", ref="e3", text="search query" - Type in an input
   - kind="press", key="Enter" - Press a key
   - kind="scroll", direction="down" - Scroll the page
4. **snapshot** again - See updated page after interaction
5. **Repeat steps 3-4** until you find the content you need
6. **read** - Extract full text content from the page
7. **close** - Free browser resources when done

## Snapshot Format

The snapshot returns an AI-optimized accessibility tree with refs:
- navigation [ref=e1]:
  - link "Home" [ref=e2]
  - link "Investors" [ref=e3]
  - link "Press Releases" [ref=e4]
- main:
  - heading "Welcome to Acme Corp" [ref=e5]
  - paragraph: Latest news and updates
  - link "Q4 2024 Earnings" [ref=e6]
  - link "View All Press Releases" [ref=e7]

## Act Action Examples

To click a link with ref=e4:
  action="act", request with kind="click" and ref="e4"

To type in a search box with ref=e10:
  action="act", request with kind="type", ref="e10", text="earnings"

To press Enter:
  action="act", request with kind="press" and key="Enter"

## Example: Finding a Press Release

1. navigate to https://investors.company.com
2. snapshot - see links like "Press Releases" [ref=e4]
3. act with kind="click", ref="e4" - click Press Releases link
4. snapshot - see list of press releases
5. act with kind="click", ref="e12" - click specific press release
6. read - extract the full press release text

## Usage Notes

- Always call snapshot after navigate/open - they return only url/title, no content
- Use **open** to start a fresh tab; use **navigate** to go to a URL within the current tab
- After clicking, always call snapshot again to see the new page
- The browser persists across calls - no need to re-navigate to the same URL
- Use read for bulk text extraction once you've navigated to the right page
- Close the browser when done to free system resources
`.trim();

/**
 * Ensure browser and page are initialized.
 * Lazily launches a Chromium browser on first use. Headless by default; set
 * `ALESIA_BROWSER_HEADLESS=false` to surface the window for debugging.
 */
async function ensureBrowser(): Promise<Page> {
  if (!browser) {
    const headless = process.env.ALESIA_BROWSER_HEADLESS !== 'false';
    browser = await chromium.launch({ headless });
  }
  if (!page) {
    const context = await browser.newContext();
    page = await context.newPage();
    await installUrlGuard(page);
  }
  return page;
}

/**
 * Close the browser and reset state.
 */
async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    currentRefs.clear();
  }
}

/**
 * Parse refs from the AI snapshot format.
 * Extracts [ref=eN] patterns and builds a ref map.
 */
function parseRefsFromSnapshot(snapshot: string): Map<string, { role: string; name?: string; nth?: number }> {
  const refs = new Map<string, { role: string; name?: string; nth?: number }>();
  const lines = snapshot.split('\n');
  
  for (const line of lines) {
    // Match patterns like: - button "Click me" [ref=e12]
    const refMatch = line.match(/\[ref=(e\d+)\]/);
    if (!refMatch) continue;
    
    const ref = refMatch[1];
    
    // Extract role (first word after "- ")
    const roleMatch = line.match(/^\s*-\s*(\w+)/);
    const role = roleMatch ? roleMatch[1] : 'generic';
    
    // Extract name (text in quotes)
    const nameMatch = line.match(/"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : undefined;
    
    // Extract nth if present
    const nthMatch = line.match(/\[nth=(\d+)\]/);
    const nth = nthMatch ? parseInt(nthMatch[1], 10) : undefined;
    
    refs.set(ref, { role, name, nth });
  }
  
  return refs;
}

/**
 * Resolve a ref to a Playwright locator using stored ref data.
 */
function resolveRefToLocator(p: Page, ref: string): ReturnType<Page['locator']> {
  const refData = currentRefs.get(ref);
  
  if (!refData) {
    // Fallback to aria-ref selector if ref not in map
    return p.locator(`aria-ref=${ref}`);
  }
  
  // Use getByRole with the stored role and name for reliable resolution
  const options: { name?: string | RegExp; exact?: boolean } = {};
  if (refData.name) {
    options.name = refData.name;
    options.exact = true;
  }
  
  let locator = p.getByRole(refData.role as Parameters<Page['getByRole']>[0], options);
  
  // Handle nth occurrence if specified
  if (typeof refData.nth === 'number' && refData.nth > 0) {
    locator = locator.nth(refData.nth);
  }
  
  return locator;
}

/**
 * Take an AI-optimized snapshot using Playwright's _snapshotForAI method.
 * Falls back to ariaSnapshot if _snapshotForAI is not available.
 */
async function takeSnapshot(p: Page, maxChars?: number): Promise<{ snapshot: string; truncated: boolean }> {
  const pageWithSnapshot = p as PageWithSnapshotForAI;
  
  let snapshot: string;
  
  if (pageWithSnapshot._snapshotForAI) {
    // Use the AI-optimized snapshot method
    const result = await pageWithSnapshot._snapshotForAI({ timeout: 10000, track: 'response' });
    snapshot = String(result?.full ?? '');
  } else {
    // Fallback to standard ariaSnapshot
    snapshot = await p.locator(':root').ariaSnapshot();
  }
  
  // Parse and store refs for later action resolution
  currentRefs = parseRefsFromSnapshot(snapshot);
  
  // Truncate if needed
  let truncated = false;
  const limit = maxChars ?? 50000;
  if (snapshot.length > limit) {
    snapshot = `${snapshot.slice(0, limit)}\n\n[...TRUNCATED - page too large, use read action for full text]`;
    truncated = true;
  }
  
  return { snapshot, truncated };
}

// Schema for the act action's request object
const actRequestSchema = z.object({
  kind: z.enum(['click', 'type', 'press', 'hover', 'scroll', 'wait']).describe('The type of interaction'),
  ref: z.string().optional().describe('Element ref from snapshot (e.g., e12)'),
  text: z.string().optional().describe('Text for type action'),
  key: z.string().optional().describe('Key for press action (e.g., Enter, Tab)'),
  direction: z.enum(['up', 'down']).optional().describe('Scroll direction'),
  timeMs: z.number().optional().describe('Wait time in milliseconds'),
});

export const browserTool = new DynamicStructuredTool({
  name: 'browser',
  description: 'Navigate websites, read content, and interact with pages. Use for accessing company websites, earnings reports, and dynamic content.',
  schema: z.object({
    action: z.enum(['navigate', 'open', 'snapshot', 'act', 'read', 'close']).describe('The browser action to perform'),
    url: z.string().optional().describe('URL for navigate action'),
    maxChars: z.number().optional().describe('Max characters for snapshot (default 50000)'),
    request: actRequestSchema.optional().describe('Request object for act action'),
  }),
  func: async ({ action, url, maxChars, request }) => {
    try {
      switch (action) {
        case 'navigate': {
          if (!url) {
            return formatToolResult({ error: 'url is required for navigate action' });
          }
          await assertNavigableUrl(url);
          const p = await ensureBrowser();
          // Use networkidle for better JS rendering on dynamic sites
          await p.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
          return formatToolResult({
            ok: true,
            url: p.url(),
            title: await p.title(),
            hint: 'Page loaded. Call snapshot to see page structure and find elements to interact with.',
          });
        }

        case 'open': {
          if (!url) {
            return formatToolResult({ error: 'url is required for open action' });
          }
          await assertNavigableUrl(url);
          const currentPage = await ensureBrowser();
          const context = currentPage.context();
          const newPage = await context.newPage();
          await installUrlGuard(newPage);
          await newPage.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
          // Close the previous page so it can't keep loading in the background
          // and so we don't leak handles. Best-effort — failure is non-fatal.
          if (currentPage !== newPage) {
            await currentPage.close().catch(() => {});
          }
          page = newPage;
          currentRefs.clear();
          return formatToolResult({
            ok: true,
            url: newPage.url(),
            title: await newPage.title(),
            hint: 'New tab opened. Call snapshot to see page structure and find elements to interact with.',
          });
        }

        case 'snapshot': {
          const p = await ensureBrowser();
          // Wait for any dynamic content to settle
          await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          
          const { snapshot, truncated } = await takeSnapshot(p, maxChars);
          
          return formatToolResult({
            url: p.url(),
            title: await p.title(),
            snapshot,
            truncated,
            refCount: currentRefs.size,
            refs: Object.fromEntries(currentRefs),
            hint: 'Use act with kind="click" and ref="eN" to click elements. Or navigate directly to a /url visible in the snapshot.',
          });
        }

        case 'act': {
          if (!request) {
            return formatToolResult({ error: 'request is required for act action' });
          }
          
          const p = await ensureBrowser();
          const { kind, ref, text, key, direction, timeMs } = request;
          
          switch (kind) {
            case 'click': {
              if (!ref) {
                return formatToolResult({ error: 'ref is required for click' });
              }
              const locator = resolveRefToLocator(p, ref);
              await locator.click({ timeout: 8000 });
              // Wait for navigation/content to load
              await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
              return formatToolResult({ 
                ok: true, 
                clicked: ref,
                hint: 'Click successful. Call snapshot to see the updated page.',
              });
            }
            
            case 'type': {
              if (!ref) {
                return formatToolResult({ error: 'ref is required for type' });
              }
              if (!text) {
                return formatToolResult({ error: 'text is required for type' });
              }
              const locator = resolveRefToLocator(p, ref);
              await locator.fill(text, { timeout: 8000 });
              return formatToolResult({ ok: true, ref, typed: text });
            }
            
            case 'press': {
              if (!key) {
                return formatToolResult({ error: 'key is required for press' });
              }
              await p.keyboard.press(key);
              await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
              return formatToolResult({ ok: true, pressed: key });
            }
            
            case 'hover': {
              if (!ref) {
                return formatToolResult({ error: 'ref is required for hover' });
              }
              const locator = resolveRefToLocator(p, ref);
              await locator.hover({ timeout: 8000 });
              return formatToolResult({ ok: true, hovered: ref });
            }
            
            case 'scroll': {
              const scrollDirection = direction ?? 'down';
              const amount = scrollDirection === 'down' ? 500 : -500;
              await p.mouse.wheel(0, amount);
              await p.waitForTimeout(500);
              return formatToolResult({ ok: true, scrolled: scrollDirection });
            }
            
            case 'wait': {
              const waitTime = Math.min(timeMs ?? 2000, 10000);
              await p.waitForTimeout(waitTime);
              return formatToolResult({ ok: true, waited: waitTime });
            }
            
            default:
              return formatToolResult({ error: `Unknown act kind: ${kind}` });
          }
        }

        case 'read': {
          const p = await ensureBrowser();
          // Wait for content to be fully loaded
          await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          
          // Extract visible text from main content area, falling back to body
          const content = await p.evaluate(() => {
            const main = document.querySelector('main, article, [role="main"], .content, #content') as HTMLElement | null;
            return (main || document.body).innerText;
          });
          return formatToolResult({
            url: p.url(),
            title: await p.title(),
            content,
          });
        }

        case 'close': {
          await closeBrowser();
          return formatToolResult({ ok: true, message: 'Browser closed' });
        }

        default:
          return formatToolResult({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Browser (Playwright)] error: ${message}`);
      return formatToolResult({ error: `[Browser (Playwright)] ${message}` });
    }
  },
});

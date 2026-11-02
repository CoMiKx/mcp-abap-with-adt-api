import { ADTClient } from 'abap-adt-api';

/**
 * Session recovery and readable errors for ADT calls.
 *
 * abap-adt-api only re-logs in after an expired session when the client is stateless.
 * This server runs stateful (needed for locks), so an expired session surfaced as a bare
 * "Request failed with status code 400" on every later call until the server was restarted.
 * This wraps the client's request method to log in again once and retry, and puts SAP's
 * own error text (from the response body) into the error message.
 */

const BODY_EXCERPT = 600;

function responseOf(e: any): { status?: number; statusText?: string; body?: string } | undefined {
  return e?.parent?.response ?? e?.response;
}

function statusOf(e: any): number | undefined {
  const s = e?.status ?? e?.err ?? responseOf(e)?.status;
  return typeof s === 'number' ? s : undefined;
}

/** ADT business errors come back as an <exc:exception> document; those are real answers, not session problems. */
function isAdtBusinessError(e: any): boolean {
  return e?.typeID === Symbol.for('ADT EXCEPTION') && !!e?.type;
}

function bodyText(body?: string): string {
  if (!body) return '';
  return body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSessionProblem(e: any, strict: boolean): boolean {
  const status = statusOf(e);
  if (status === 401 || e?.typeID === Symbol.for('BAD CSRF')) return true;
  const resp = responseOf(e);
  const text = `${resp?.statusText || ''} ${bodyText(resp?.body).slice(0, 2000)} ${e?.message || ''}`;
  if (/session (timed out|expired|not found|terminated)|no longer valid|ICMENOSESSION|CSRF token validation failed|logon (ticket|failed)/i.test(text)) {
    return true;
  }
  // Non-ADT 400/403 (HTML or empty body) after an idle period is almost always a dead session.
  // In browser-login mode a re-login opens the browser, so only act on explicit signals there.
  return !strict && (status === 400 || status === 403) && !isAdtBusinessError(e);
}

/** Adds SAP's explanation (response body, localized message) to the error message, keeping the error object. */
export function enrichError(e: any): any {
  if (!e || typeof e !== 'object' || e.__enriched) return e;
  const resp = responseOf(e);
  const parts: string[] = [];
  const status = statusOf(e);
  if (status && !String(e.message || '').includes(String(status))) parts.push(`HTTP ${status}`);
  if (e.localizedMessage && e.localizedMessage !== e.message) parts.push(e.localizedMessage);
  if (e.properties && typeof e.properties === 'object') {
    const props = Object.entries(e.properties)
      .filter(([k, v]) => v && !/^(T100KEY-|LONGTEXT_URL)/.test(k))
      .map(([k, v]) => {
        const t = bodyText(String(v));
        return `${k}=${t.length > 300 ? `${t.slice(0, 300)}…` : t}`;
      });
    if (props.length) parts.push(props.join(', '));
  }
  const text = bodyText(resp?.body);
  if (text && !String(e.message || '').includes(text.slice(0, 50))) {
    parts.push(`SAP response: ${text.slice(0, BODY_EXCERPT)}${text.length > BODY_EXCERPT ? '…' : ''}`);
  }
  if (parts.length) {
    const message = `${e.message || 'Request failed'} (${parts.join(' | ')})`;
    try {
      Object.defineProperty(e, 'message', { value: message, configurable: true, writable: true });
    } catch {
      // read-only error object: leave as is
    }
  }
  try {
    Object.defineProperty(e, '__enriched', { value: true });
  } catch {
    // ignore
  }
  return e;
}

/**
 * @param strict only treat explicit session signals as expiry (use for browser login,
 *               where re-login opens the browser)
 */
export function enableSessionRecovery(client: ADTClient, strict = false) {
  const h: any = client.httpClient;
  const original = h.request.bind(h);
  let relogin: Promise<void> | undefined;

  h.request = async (url: string, config?: any) => {
    try {
      return await original(url, config);
    } catch (e: any) {
      if (!looksLikeSessionProblem(e, strict)) throw enrichError(e);
      try {
        console.error(`MCP ABAP ADT: request to ${url} failed (${e?.message}); logging in again and retrying once`);
        relogin ??= (async () => {
          h.csrfToken = 'fetch';
          await h.login();
        })().finally(() => { relogin = undefined; });
        await relogin;
      } catch (loginError: any) {
        throw enrichError(loginError);
      }
      try {
        return await original(url, config);
      } catch (e2: any) {
        const err = enrichError(e2);
        try {
          Object.defineProperty(err, 'message', {
            value: `${err.message} [session was renewed and the call retried once; lock handles from before are no longer valid]`,
            configurable: true,
            writable: true
          });
        } catch {
          // ignore
        }
        throw err;
      }
    }
  };
}

import http from 'http';
import { AddressInfo } from 'net';
import { spawn } from 'child_process';
import axios from 'axios';
import { HttpClient } from 'abap-adt-api';
import { AxiosHttpClient } from 'abap-adt-api/build/AxiosHttpClient';
import { HttpClientOptions, HttpClientResponse } from 'abap-adt-api/build/AdtHTTP';

/**
 * Browser-based login (reentrance ticket) for SAP S/4HANA Cloud Public Edition (GROW).
 *
 * Same flow as Eclipse ADT / SAP Fiori tools:
 *  1. Open the browser at <UI host>/sap/bc/sec/reentrance?redirect-url=http://localhost:<port>/redirect
 *  2. User logs in with email/password (+2FA) through SAP Cloud Identity
 *  3. SAP redirects back to the local listener with ?reentrance-ticket=...
 *  4. First ADT request sends the ticket as MYSAPSSO2 with x-sap-security-session: create;
 *     the returned session cookies are then kept by abap-adt-api.
 */

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REENTRANCE_ENDPOINT = '/sap/bc/sec/reentrance';
const REDIRECT_PATH = '/redirect';

interface VirtualHosts {
  ui: string;
  api: string;
}

/** Resolve UI (login) and API (ADT) hosts; tenants expose both via a public endpoint. */
async function resolveVirtualHosts(systemUrl: string): Promise<VirtualHosts> {
  const origin = new URL(systemUrl).origin;
  try {
    const resp = await axios.get(`${origin}/sap/public/bc/icf/virtualhost`, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });
    const related = resp.data?.relatedUrls;
    if (related?.UI && related?.API) {
      return { ui: new URL(related.UI).origin, api: new URL(related.API).origin };
    }
  } catch {
    // fall through to hostname heuristic
  }
  // myXXXXXX.s4hana.cloud.sap (UI) <-> myXXXXXX-api.s4hana.cloud.sap (API)
  const url = new URL(origin);
  const [first, ...rest] = url.hostname.split('.');
  const base = first.replace(/-api$/, '');
  return {
    ui: `${url.protocol}//${[base, ...rest].join('.')}`,
    api: `${url.protocol}//${[`${base}-api`, ...rest].join('.')}`
  };
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] :
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] :
    ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* URL is also printed to stderr */ });
    child.unref();
  } catch {
    // URL is also printed to stderr
  }
}

const successHtml = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:15vh">
<h2>SAP login successful</h2><p>You can close this tab and return to Claude.</p></body></html>`;
const errorHtml = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:15vh">
<h2>SAP login failed</h2><p>No reentrance ticket was received. Check that your user has the developer role (SAP_BR_DEVELOPER).</p></body></html>`;

/** Opens the browser for login and waits for the reentrance ticket on a local port. */
function fetchReentranceTicket(uiHost: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end();
        return;
      }
      clearTimeout(timer);
      const ticket = reqUrl.searchParams.get('reentrance-ticket');
      res.writeHead(ticket ? 200 : 500, { 'Content-Type': 'text/html' });
      res.end(ticket ? successHtml : errorHtml);
      server.close();
      if (ticket) resolve(ticket);
      else reject(new Error('SAP browser login failed: no reentrance ticket received'));
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const redirectUrl = `http://localhost:${port}${REDIRECT_PATH}`;
      const loginUrl = `${uiHost}${REENTRANCE_ENDPOINT}?scenario=FTO1&redirect-url=${encodeURIComponent(redirectUrl)}`;
      timer = setTimeout(() => {
        server.close();
        reject(new Error(`SAP browser login timed out after ${LOGIN_TIMEOUT_MS / 60000} minutes`));
      }, LOGIN_TIMEOUT_MS);
      console.error(`MCP ABAP ADT: Opening browser for SAP login. If it does not open, visit:\n${loginUrl}`);
      openBrowser(loginUrl);
    });
  });
}

/**
 * HttpClient for abap-adt-api that authenticates with a browser login instead of a password.
 * Re-opens the browser automatically when the SAP session expires (HTTP 401).
 */
export class BrowserLoginHttpClient implements HttpClient {
  private inner?: AxiosHttpClient;
  private hosts?: Promise<VirtualHosts>;
  private ticketPromise?: Promise<string>;
  private needsTicket = true;

  constructor(private readonly systemUrl: string) {}

  private async client(): Promise<{ inner: AxiosHttpClient; hosts: VirtualHosts }> {
    this.hosts ??= resolveVirtualHosts(this.systemUrl);
    const hosts = await this.hosts;
    this.inner ??= new AxiosHttpClient(hosts.api);
    return { inner: this.inner, hosts };
  }

  /** One browser login at a time, shared by concurrent requests. */
  private ticket(uiHost: string): Promise<string> {
    this.ticketPromise ??= fetchReentranceTicket(uiHost).finally(() => {
      this.ticketPromise = undefined;
    });
    return this.ticketPromise;
  }

  private async send(options: HttpClientOptions, withTicket: boolean): Promise<HttpClientResponse> {
    const { inner, hosts } = await this.client();
    // abap-adt-api adds basic auth with an empty password when no password is given; never send it
    const req: HttpClientOptions = { ...options, auth: undefined, headers: { ...options.headers } };
    if (withTicket) {
      const ticket = await this.ticket(hosts.ui);
      delete req.headers!['Cookie'];
      req.headers!['MYSAPSSO2'] = ticket;
      req.headers!['x-sap-security-session'] = 'create';
    }
    const resp = await inner.request(req);
    if (withTicket) this.needsTicket = false;
    return resp;
  }

  async request(options: HttpClientOptions): Promise<HttpClientResponse> {
    const withTicket = this.needsTicket;
    try {
      return await this.send(options, withTicket);
    } catch (e: any) {
      if (e?.status !== 401) throw e;
      if (withTicket) {
        this.needsTicket = true;
        throw e;
      }
      // Session expired: log in again in the browser and retry once
      console.error('MCP ABAP ADT: SAP session expired, re-authenticating in browser');
      this.needsTicket = true;
      return await this.send(options, true);
    }
  }
}

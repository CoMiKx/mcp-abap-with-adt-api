import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { BaseHandler } from './BaseHandler';
import type { ToolDefinition } from '../types/tools';

/**
 * Object URL to lock for a source URL:
 * /sap/bc/adt/programs/includes/zfoo/source/main -> /sap/bc/adt/programs/includes/zfoo
 * /sap/bc/adt/oo/classes/zcl_foo/includes/testclasses -> /sap/bc/adt/oo/classes/zcl_foo
 */
export const objectUrlFromSourceUrl = (sourceUrl: string) =>
  sourceUrl
    .replace(/\/source\/main$/, '')
    .replace(/^(\/sap\/bc\/adt\/oo\/classes\/[^/]+)\/includes\/[^/]+$/, '$1');

function absolutePath(p: string): string {
  if (!path.isAbsolute(p)) {
    throw new Error(`File path must be absolute: ${p}`);
  }
  return p;
}

export class ObjectSourceHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'getObjectSource',
        description: 'Retrieves source code for ABAP objects. For large sources use startLine/endLine, ' +
          'or outputFile to save the full source to a local file (edit it and write it back with setObjectSourceFromFile).',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string' },
            options: { type: 'string' },
            startLine: { type: 'number', description: 'First line to return (1-based)', optional: true },
            endLine: { type: 'number', description: 'Last line to return (inclusive)', optional: true },
            outputFile: { type: 'string', description: 'Absolute local path; the full source is written there instead of returned', optional: true }
          },
          required: ['objectSourceUrl']
        }
      },
      {
        name: 'setObjectSourceFromFile',
        description: 'Writes the source of an ABAP object from a local file: locks, saves and unlocks in one call ' +
          '(no need to send large sources through the tool call). Does not activate; call activateByName afterwards.',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string', description: 'e.g. /sap/bc/adt/programs/programs/zfoo/source/main' },
            filePath: { type: 'string', description: 'Absolute path of the local file holding the complete new source' },
            objectUrl: { type: 'string', description: 'Object URL to lock; derived from objectSourceUrl if omitted', optional: true },
            transport: { type: 'string', description: 'Transport request', optional: true }
          },
          required: ['objectSourceUrl', 'filePath']
        }
      },
      {
        name: 'getMessageClass',
        description: 'Reads the messages of a message class (SE91) as a compact list. Optionally only some message numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            messageClass: { type: 'string', description: 'Message class name, e.g. ZFI' },
            numbers: { type: 'array', items: { type: 'string' }, description: 'Message numbers, e.g. ["001","015"]', optional: true }
          },
          required: ['messageClass']
        }
      },
      {
        name: 'setObjectSource',
        description: 'Sets source code for ABAP objects',
        inputSchema: {
          type: 'object',
          properties: {
            objectSourceUrl: { type: 'string' },
            source: { type: 'string' },
            lockHandle: { type: 'string' },
            transport: { type: 'string' }
          },
          required: ['objectSourceUrl', 'source', 'lockHandle']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'getObjectSource':
        return this.handleGetObjectSource(args);
      case 'setObjectSource':
        return this.handleSetObjectSource(args);
      case 'setObjectSourceFromFile':
        return this.handleSetObjectSourceFromFile(args);
      case 'getMessageClass':
        return this.handleGetMessageClass(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown object source tool: ${toolName}`);
    }
  }

  async handleGetObjectSource(args: any): Promise<any> {
    
    const startTime = performance.now();
    try {
      const source = await this.adtclient.getObjectSource(args.objectSourceUrl, args.options);
      const lines = source.split(/\r?\n/);
      let result: Record<string, unknown>;
      if (args.outputFile) {
        const file = absolutePath(args.outputFile);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source, 'utf8');
        result = { savedTo: file, totalLines: lines.length, bytes: Buffer.byteLength(source) };
      } else if (args.startLine || args.endLine) {
        const from = Math.max(1, args.startLine || 1);
        const to = Math.min(lines.length, args.endLine || lines.length);
        result = {
          totalLines: lines.length,
          startLine: from,
          endLine: to,
          source: lines.slice(from - 1, to).join('\n')
        };
      } else {
        result = { source };
      }
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              ...result
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get object source: ${error.message || 'Unknown error'}`
      );
    }
  }

  async handleSetObjectSource(args: any): Promise<any> {    
    const startTime = performance.now();
    try {
      await this.adtclient.setObjectSource(
        args.objectSourceUrl,
        args.source,
        args.lockHandle,
        args.transport
      );
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              updated: true
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set object source: ${error.message || 'Unknown error'}`
      );
    }
  }

  async handleSetObjectSourceFromFile(args: any): Promise<any> {
    const startTime = performance.now();
    const objectUrl = args.objectUrl || objectUrlFromSourceUrl(args.objectSourceUrl);
    try {
      const source = await fs.readFile(absolutePath(args.filePath), 'utf8');
      if (!source.trim()) {
        throw new Error(`File is empty: ${args.filePath}`);
      }
      const lock = await this.adtclient.lock(objectUrl);
      try {
        await this.adtclient.setObjectSource(args.objectSourceUrl, source, lock.LOCK_HANDLE, args.transport);
      } finally {
        await this.adtclient.unLock(objectUrl, lock.LOCK_HANDLE).catch(() => undefined);
      }
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              updated: true,
              objectUrl,
              lines: source.split(/\r?\n/).length,
              next: 'Activate with activateByName, then read the source back to verify.'
            })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set object source from file: ${error.message || 'Unknown error'}`
      );
    }
  }

  async handleGetMessageClass(args: any): Promise<any> {
    const startTime = performance.now();
    try {
      const name = String(args.messageClass).toLowerCase();
      const response = await this.adtclient.httpClient.request(
        `/sap/bc/adt/messageclass/${encodeURIComponent(name)}`,
        { headers: { Accept: 'application/vnd.sap.adt.mc.messageclass+xml, application/xml;q=0.9, */*;q=0.8' } }
      );
      const wanted = Array.isArray(args.numbers) && args.numbers.length
        ? new Set(args.numbers.map((n: string) => String(n).padStart(3, '0')))
        : undefined;
      const messages = parseMessages(response.body)
        .filter(m => !wanted || wanted.has(m.number));
      if (!messages.length && !wanted) {
        throw new Error('No messages found in the response; the message class may be empty or the format is not supported on this system.');
      }
      this.trackRequest(startTime, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'success', messageClass: args.messageClass.toUpperCase(), messages })
          }
        ]
      };
    } catch (error: any) {
      this.trackRequest(startTime, false);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get message class: ${error.message || 'Unknown error'}`
      );
    }
  }
}

const decodeXml = (v: string) =>
  v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Message elements carry msgno and msgtext attributes (namespace prefix varies by release). */
function parseMessages(xml: string): { number: string; text: string }[] {
  const result: { number: string; text: string }[] = [];
  const elements = xml.match(/<[\w:]*messages?\b[^>]*>/g) || [];
  for (const el of elements) {
    const no = el.match(/\bmsgno="([^"]*)"/)?.[1];
    const text = el.match(/\bmsgtext="([^"]*)"/)?.[1];
    if (no !== undefined && text !== undefined) {
      result.push({ number: no, text: decodeXml(text) });
    }
  }
  return result;
}

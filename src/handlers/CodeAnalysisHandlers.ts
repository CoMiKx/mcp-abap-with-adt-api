import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient } from 'abap-adt-api';
import { sourceCache } from '../lib/sourceCache.js';

const SOURCE_OBJECT = /\/sap\/bc\/adt\/(programs\/(programs|includes)|oo\/(classes|interfaces)|functions\/groups\/[^/]+\/(fmodules|includes))\/[^/?#]+$/i;

/** Program, include, class, interface and function module URLs need the /source/main suffix. */
function toSourceUrl(url: string): string {
    if (!url) throw new Error('url is required');
    const clean = url.replace(/\/$/, '');
    return SOURCE_OBJECT.test(clean) ? `${clean}/source/main` : clean;
}

export class CodeAnalysisHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'syntaxCheckCode',
                description: 'Perform ABAP syntax check of source code without saving it. ' +
                    'url is the source being checked (e.g. /sap/bc/adt/programs/includes/zfoo_f01/source/main); ' +
                    'object URLs without /source/main are completed automatically. ' +
                    'For includes, the main program is looked up automatically (pass mainProgram, e.g. /sap/bc/adt/programs/programs/zfoo, to choose one); ' +
                    'an include checked without its main program reports no errors even when the code is broken. mainUrl defaults to url and rarely needs to be set. ' +
                    'code may be omitted to check the source last read or written for url in this session (getObjectSource, setObjectSource, setObjectSourceFromFile, replace_in_object).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        url: { type: 'string', optional: true },
                        mainUrl: { type: 'string', optional: true },
                        mainProgram: { type: 'string', optional: true },
                        version: { type: 'string', optional: true }
                    },
                    required: ['url']
                }
            },
            {
                name: 'syntaxCheckCdsUrl',
                description: 'Perform ABAP syntax check with CDS URL',
                inputSchema: {
                    type: 'object',
                    properties: {
                        cdsUrl: { type: 'string' }
                    },
                    required: ['cdsUrl']
                }
            },
            {
                name: 'codeCompletion',
                description: 'Get code completion suggestions',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column']
                }
            },
            {
                name: 'findDefinition',
                description: 'Find symbol definition',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        startCol: { type: 'number' },
                        endCol: { type: 'number' },
                        implementation: { type: 'boolean', optional: true },
                        mainProgram: { type: 'string', optional: true }
                    },
                    required: ['url', 'source', 'line', 'startCol', 'endCol']
                }
            },
            {
                name: 'usageReferences',
                description: 'Find symbol references',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        line: { type: 'number', optional: true },
                        column: { type: 'number', optional: true }
                    },
                    required: ['url']
                }
            },
            {
                name: 'syntaxCheckTypes',
                description: 'Retrieves syntax check types.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'codeCompletionFull',
                description: 'Performs full code completion.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' },
                        patternKey: { type: 'string' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column', 'patternKey']
                }
            },
            {
                name: 'runClass',
                description: 'Runs a class.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        className: { type: 'string' }
                    },
                    required: ['className']
                }
            },
            {
                name: 'codeCompletionElement',
                description: 'Retrieves code completion element information.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceUrl: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['sourceUrl', 'source', 'line', 'column']
                }
            },
            {
                name: 'usageReferenceSnippets',
                description: 'Retrieves usage reference snippets.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        references: { type: 'array' }
                    },
                    required: ['references']
                }
            },
            {
                name: 'fixProposals',
                description: 'Retrieves fix proposals.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        source: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' }
                    },
                    required: ['url', 'source', 'line', 'column']
                }
            },
            {
                name: 'fixEdits',
                description: 'Applies fix edits.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: { type: 'string' },
                        source: { type: 'string' }
                    },
                    required: ['proposal', 'source']
                }
            },
            {
                name: 'fragmentMappings',
                description: 'Retrieves fragment mappings.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        type: { type: 'string' },
                        name: { type: 'string' }
                    },
                    required: ['url', 'type', 'name']
                }
            },
            {
                name: 'abapDocumentation',
                description: 'Retrieves ABAP documentation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        objectUri: { type: 'string' },
                        body: { type: 'string' },
                        line: { type: 'number' },
                        column: { type: 'number' },
                        language: { type: 'string', optional: true }
                    },
                    required: ['objectUri', 'body', 'line', 'column']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'syntaxCheckCode':
                return this.handleSyntaxCheckCode(args);
            case 'syntaxCheckCdsUrl':
                return this.handleSyntaxCheckCdsUrl(args);
            case 'codeCompletion':
                return this.handleCodeCompletion(args);
            case 'findDefinition':
                return this.handleFindDefinition(args);
            case 'usageReferences':
                return this.handleUsageReferences(args);
            case 'syntaxCheckTypes':
                return this.handleSyntaxCheckTypes(args);
            case 'codeCompletionFull':
                return this.handleCodeCompletionFull(args);
            case 'runClass':
                return this.handleRunClass(args);
            case 'codeCompletionElement':
                return this.handleCodeCompletionElement(args);
            case 'usageReferenceSnippets':
                return this.handleUsageReferenceSnippets(args);
            case 'fixProposals':
                return this.handleFixProposals(args);
            case 'fixEdits':
                return this.handleFixEdits(args);
            case 'fragmentMappings':
                return this.handleFragmentMappings(args);
            case 'abapDocumentation':
                return this.handleAbapDocumentation(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown code analysis tool: ${toolName}`);
        }
    }
    async handleSyntaxCheckCdsUrl(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.syntaxCheck(args.cdsUrl);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check failed: ${error.message || 'Unknown error'}`
            );
        }
    }
    async handleSyntaxCheckCode(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // ADT maps these URIs to objects; object URLs without /source/main fail with
            // "URI-Mapping cannot be performed due to invalid URI"
            const url = toSourceUrl(args.url);
            const mainUrl = args.mainUrl ? toSourceUrl(args.mainUrl) : url;
            const code = args.code || sourceCache.get(url);
            if (!code) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    `No source provided and none cached for '${url}'. Pass "code", or read the source with getObjectSource first.`
                );
            }
            let mainProgram: string | undefined = args.mainProgram;
            let note: string | undefined;
            if (!mainProgram && /\/programs\/includes\//i.test(url)) {
                const mains = await this.adtclient.mainPrograms(url.replace(/\/source\/main$/, '')).catch(() => []);
                mainProgram = mains[0]?.['adtcore:uri'];
                note = mainProgram
                    ? `Checked in the context of main program ${mains[0]['adtcore:name']}` +
                      (mains.length > 1 ? ` (${mains.length} main programs found; pass mainProgram to choose another)` : '')
                    : 'No main program found: the include was checked on its own, so errors may be missed.';
            }
            const result = await this.adtclient.syntaxCheck(url, mainUrl, code, mainProgram, args.version);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            ...(note ? { note } : {}),
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCodeCompletion(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletion(
                args.sourceUrl,
                args.source,
                args.line,
                args.column
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleFindDefinition(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.findDefinition(
                args.url,
                args.source,
                args.line,
                args.startCol,
                args.endCol,
                args.implementation,
                args.mainProgram
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Find definition failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleUsageReferences(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.usageReferences(
                args.url,
                args.line,
                args.column
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Usage references failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleSyntaxCheckTypes(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.syntaxCheckTypes();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Syntax check types failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCodeCompletionFull(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletionFull(args.sourceUrl, args.source, args.line, args.column, args.patternKey);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion full failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleRunClass(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.runClass(args.className);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Run class failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCodeCompletionElement(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.codeCompletionElement(args.sourceUrl, args.source, args.line, args.column);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Code completion element failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleUsageReferenceSnippets(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.usageReferenceSnippets(args.references);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Usage reference snippets failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleFixProposals(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fixProposals(args.url, args.source, args.line, args.column);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fix proposals failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleFixEdits(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fixEdits(args.proposal, args.source);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fix edits failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleFragmentMappings(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.fragmentMappings(args.url, args.type, args.name);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Fragment mappings failed: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAbapDocumentation(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.abapDocumentation(args.objectUri, args.body, args.line, args.column, args.language);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `ABAP documentation failed: ${error.message || 'Unknown error'}`
            );
        }
    }
}

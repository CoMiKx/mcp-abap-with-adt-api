import { ADTClient } from 'abap-adt-api';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { AtcProposal } from 'abap-adt-api';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { AtcWorkList } from 'abap-adt-api';

const WORKLIST_ID = /^[0-9A-F]{32}$/i;

/** One line per finding instead of the full worklist XML-as-JSON (100+ KB for a single program). */
function compactFindings(
    worklist: AtcWorkList,
    filter: { objectName?: string, minPriority?: number, checkTitle?: string } = {}
) {
    const name = filter.objectName?.toLowerCase();
    const title = filter.checkTitle?.toLowerCase();
    return worklist.objects
        .filter(o => !name || o.name.toLowerCase().includes(name))
        .flatMap(o => o.findings.map(f => ({
            object: o.name,
            type: o.type,
            priority: f.priority,
            include: f.location?.uri?.replace(/\/source\/main$/, '').split('/').pop(),
            line: f.location?.range?.start?.line,
            checkTitle: f.checkTitle,
            messageTitle: f.messageTitle,
            processor: (f as any).processor,
            docHref: f.link?.href
        })))
        .filter(f => !filter.minPriority || f.priority <= filter.minPriority)
        .filter(f => !title || `${f.checkTitle} ${f.messageTitle}`.toLowerCase().includes(title))
        .sort((a, b) => a.priority - b.priority);
}

function htmlToText(html: string): string {
    return (html || '')
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

export class AtcHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'atcCustomizing',
                description: 'Retrieves ATC customizing information.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'atcCheckVariant',
                description: 'Retrieves information about an ATC check variant.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        variant: {
                            type: 'string',
                            description: 'The name of the ATC check variant.'
                        }
                    },
                    required: ['variant']
                }
            },
            {
                name: 'createAtcRun',
                description: 'Runs ATC checks on an object and returns the findings. ' +
                    'Pass the check variant NAME (e.g. DEFAULT, ZABAP_CLOUD_DEVELOPMENT_3TIER); the worklist is created automatically. ' +
                    'A 32-character worklist ID from atcCheckVariant is also accepted. ' +
                    'Returns a compact findings list (set includeFindings=false to only start the run).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        variant: {
                            type: 'string',
                            description: 'ATC check variant name, or a worklist ID from atcCheckVariant.'
                        },
                        mainUrl: {
                            type: 'string',
                            description: 'The main URL for the ATC run.'
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of findings (default 1000).',
                            optional: true
                        },
                        includeFindings: {
                            type: 'boolean',
                            description: 'Fetch the findings after the run (default true).',
                            optional: true
                        },
                        minPriority: {
                            type: 'number',
                            description: 'Only return findings with priority <= this value (1 = error, 2 = warning, 3 = info).',
                            optional: true
                        }
                    },
                    required: ['variant', 'mainUrl']
                }
            },
            {
                name: 'atcWorklists',
                description: 'Retrieves the findings of an ATC run. runResultId is the worklist ID returned by createAtcRun. ' +
                    'Returns a compact list by default (object, priority, include, line, check, message, docHref); filter with objectName, minPriority, checkTitle.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        runResultId: {
                            type: 'string',
                            description: 'The ID of the ATC run result.'
                        },
                        timestamp: {
                            type: 'number',
                            description: 'The timestamp.',
                            optional: true
                        },
                        usedObjectSet: {
                            type: 'string',
                            description: 'The used object set.',
                            optional: true
                        },
                        includeExempted: {
                            type: 'boolean',
                            description: 'Whether to include exempted findings.',
                            optional: true
                        },
                        compact: {
                            type: 'boolean',
                            description: 'Return a compact findings list (default true). false returns the full raw worklist.',
                            optional: true
                        },
                        objectName: {
                            type: 'string',
                            description: 'Only findings of objects whose name contains this text (case-insensitive).',
                            optional: true
                        },
                        minPriority: {
                            type: 'number',
                            description: 'Only findings with priority <= this value (1 = error, 2 = warning, 3 = info).',
                            optional: true
                        },
                        checkTitle: {
                            type: 'string',
                            description: 'Only findings whose check or message title contains this text (case-insensitive).',
                            optional: true
                        }
                    },
                    required: ['runResultId']
                }
            },
            {
                name: 'atcFindingDocumentation',
                description: 'Reads the documentation of an ATC finding (the "Details" text in Eclipse, e.g. the successor API for a forbidden API). ' +
                    'Pass the docHref of a finding from createAtcRun/atcWorklists.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        docHref: {
                            type: 'string',
                            description: 'Finding documentation link, e.g. /sap/bc/adt/documentation/atc/documents/itemid/<id>/index/<n>'
                        }
                    },
                    required: ['docHref']
                }
            },
            {
                name: 'atcUsers',
                description: 'Retrieves a list of ATC users.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'atcExemptProposal',
                description: 'Retrieves an ATC exemption proposal.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        markerId: {
                            type: 'string',
                            description: 'The ID of the marker.'
                        }
                    },
                    required: ['markerId']
                }
            },
            {
                name: 'atcRequestExemption',
                description: 'Requests an ATC exemption.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'object',
                            description: 'The ATC exemption proposal.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'isProposalMessage',
                description: 'Checks if a given object is a proposal message.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'object',
                            description: 'The ATC exemption proposal.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'atcContactUri',
                description: 'Retrieves the contact URI for an ATC finding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        findingUri: {
                            type: 'string',
                            description: 'The URI of the ATC finding.'
                        }
                    },
                    required: ['findingUri']
                }
            },
            {
                name: 'atcChangeContact',
                description: 'Changes the contact for an ATC finding.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        itemUri: {
                            type: 'string',
                            description: 'The URI of the item.'
                        },
                        userId: {
                            type: 'string',
                            description: 'The ID of the user.'
                        }
                    },
                    required: ['itemUri', 'userId']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'atcCustomizing':
                return this.handleAtcCustomizing(args);
            case 'atcCheckVariant':
                return this.handleAtcCheckVariant(args);
            case 'createAtcRun':
                return this.handleCreateAtcRun(args);
            case 'atcFindingDocumentation':
                return this.handleAtcFindingDocumentation(args);
            case 'atcWorklists':
                return this.handleAtcWorklists(args);
            case 'atcUsers':
                return this.handleAtcUsers(args);
            case 'atcExemptProposal':
                return this.handleAtcExemptProposal(args);
            case 'atcRequestExemption':
                return this.handleAtcRequestExemption(args);
            case 'isProposalMessage':
                return this.handleIsProposalMessage(args);
            case 'atcContactUri':
                return this.handleAtcContactUri(args);
            case 'atcChangeContact':
                return this.handleAtcChangeContact(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown ATC tool: ${toolName}`);
        }
    }

    async handleAtcCustomizing(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCustomizing();
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
                `Failed to get ATC customizing: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcCheckVariant(args: { variant: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCheckVariant(args.variant);
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
                `Failed to get ATC check variant: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCreateAtcRun(args: { variant: string, mainUrl: string, maxResults?: number, includeFindings?: boolean, minPriority?: number }): Promise<any> {
        const startTime = performance.now();
        try {
            const maxResults = args.maxResults || 1000;
            // The ADT run endpoint expects a worklist ID, not a variant name. Passing the name
            // silently ran the system default checks (DS4) or failed with HTTP 400 (other systems).
            const worklistId = WORKLIST_ID.test(args.variant)
                ? args.variant
                : (await this.adtclient.atcCheckVariant(args.variant)).trim();
            const run = await this.adtclient.createAtcRun(worklistId, args.mainUrl, maxResults);

            if (!run.id || /^0+$/.test(run.id)) {
                throw new Error(`ATC run returned no run ID (${run.id || 'empty'}) for variant '${args.variant}'. The variant may not exist on this system.`);
            }

            const infos = run.infos.map(i => `${i.type}: ${i.description}`);
            const result: any = {
                variant: args.variant,
                worklistId,
                runId: run.id,
                timestamp: run.timestamp,
                infos
            };
            const stats = run.infos.find(i => i.type === 'FINDING_STATS')?.description;
            if (stats) {
                const [errors, warnings, infosCount] = stats.split(',').map(n => parseInt(n, 10) || 0);
                result.findingStats = { errors, warnings, infos: infosCount };
            }

            if (args.includeFindings !== false) {
                const worklist = await this.adtclient.atcWorklists(worklistId, run.timestamp, '', false);
                const findings = compactFindings(worklist, { minPriority: args.minPriority });
                result.findingCount = findings.length;
                result.findings = findings;
                const total = worklist.objects.reduce((n, o) => n + o.findings.length, 0);
                if (total >= maxResults) {
                    result.warning = `Result limit reached (${maxResults}); some findings may be missing. Increase maxResults.`;
                }
            } else {
                result.next = `Call atcWorklists with runResultId=${worklistId} and timestamp=${run.timestamp}`;
            }

            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ status: 'success', result })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to create ATC run: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcWorklists(args: { runResultId: string, timestamp?: number, usedObjectSet?: string, includeExempted?: boolean, compact?: boolean, objectName?: string, minPriority?: number, checkTitle?: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const worklist = await this.adtclient.atcWorklists(args.runResultId, args.timestamp || 0, args.usedObjectSet || "", args.includeExempted);
            const result = args.compact === false
                ? worklist
                : {
                    id: worklist.id,
                    timestamp: worklist.timestamp,
                    findings: compactFindings(worklist, args)
                };
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
                `Failed to get ATC worklists: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcFindingDocumentation(args: { docHref: string }): Promise<any> {
        const startTime = performance.now();
        try {
            if (!args.docHref?.startsWith('/sap/bc/adt/')) {
                throw new Error('docHref must be an ADT path starting with /sap/bc/adt/');
            }
            const response = await this.adtclient.atcDocumentation(args.docHref);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: htmlToText(response.body)
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get ATC finding documentation: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcUsers(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcUsers();
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
                `Failed to get ATC users: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcExemptProposal(args: { markerId: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcExemptProposal(args.markerId);
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
                `Failed to get ATC exempt proposal: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcRequestExemption(args: { proposal: AtcProposal }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcRequestExemption(args.proposal);
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
                `Failed to request ATC exemption: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleIsProposalMessage(args: { proposal: AtcProposal }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.isProposalMessage(args.proposal);
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
                `Failed to check if proposal message: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcContactUri(args: { findingUri: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcContactUri(args.findingUri);
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
                `Failed to get ATC contact URI: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleAtcChangeContact(args: { itemUri: string, userId: string }): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcChangeContact(args.itemUri, args.userId);
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
                `Failed to change ATC contact: ${error.message || 'Unknown error'}`
            );
        }
    }
}

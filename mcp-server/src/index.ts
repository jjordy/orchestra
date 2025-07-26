#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WorktreeOperations } from './worktree-operations.js';
import { PermissionHandler } from './permission-handler.js';

// Environment variables for worktree configuration
const WORKTREE_PATH = process.env.WORKTREE_PATH;
const WORKTREE_ID = process.env.WORKTREE_ID;
const APPROVAL_CALLBACK_URL = process.env.APPROVAL_CALLBACK_URL;

if (!WORKTREE_PATH || !WORKTREE_ID) {
  console.error('Missing required environment variables: WORKTREE_PATH, WORKTREE_ID');
  process.exit(1);
}

class OrchestraWorktreeMcpServer {
  private server: Server;
  private worktreeOps: WorktreeOperations;
  private permissionHandler: PermissionHandler;

  constructor() {
    this.server = new Server(
      {
        name: 'orchestra-worktree-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.worktreeOps = new WorktreeOperations(WORKTREE_PATH!, WORKTREE_ID!);
    this.permissionHandler = new PermissionHandler(APPROVAL_CALLBACK_URL);
    
    this.setupToolHandlers();
    this.setupErrorHandler();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_command',
            description: 'Execute a shell command in the worktree directory',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'The command to execute',
                },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Command arguments',
                  default: [],
                },
              },
              required: ['command'],
            },
          },
          {
            name: 'read_file',
            description: 'Read the contents of a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to read (relative to worktree)',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Write content to a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the file to write (relative to worktree)',
                },
                content: {
                  type: 'string',
                  description: 'Content to write to the file',
                },
              },
              required: ['path', 'content'],
            },
          },
          {
            name: 'list_directory',
            description: 'List contents of a directory',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Directory path to list (relative to worktree)',
                  default: '.',
                },
              },
            },
          },
          {
            name: 'approval_prompt',
            description: 'Handle permission requests for tool execution',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: {
                  type: 'string',
                  description: 'Name of the tool requesting permission',
                },
                input: {
                  type: 'object',
                  description: 'Input parameters for the tool',
                },
                tool_use_id: {
                  type: 'string',
                  description: 'Optional unique identifier for the tool use request',
                },
              },
              required: ['tool_name', 'input'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'execute_command':
            return await this.handleExecuteCommand(args);
          
          case 'read_file':
            return await this.handleReadFile(args);
          
          case 'write_file':
            return await this.handleWriteFile(args);
          
          case 'list_directory':
            return await this.handleListDirectory(args);
          
          case 'approval_prompt':
            return await this.handleApprovalPrompt(args);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });
  }

  private async handleExecuteCommand(args: any) {
    const { command, args: cmdArgs = [] } = args;
    const result = await this.worktreeOps.executeCommand(command, cmdArgs);
    
    return {
      content: [
        {
          type: 'text',
          text: `Command: ${command} ${cmdArgs.join(' ')}\nExit Code: ${result.exitCode}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`,
        },
      ],
    };
  }

  private async handleReadFile(args: any) {
    const { path } = args;
    const content = await this.worktreeOps.readFile(path);
    
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  private async handleWriteFile(args: any) {
    const { path, content } = args;
    await this.worktreeOps.writeFile(path, content);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully wrote to ${path}`,
        },
      ],
    };
  }

  private async handleListDirectory(args: any) {
    const { path = '.' } = args;
    const entries = await this.worktreeOps.listDirectory(path);
    
    return {
      content: [
        {
          type: 'text',
          text: entries.join('\n'),
        },
      ],
    };
  }

  private async handleApprovalPrompt(args: any) {
    const { tool_name, input, tool_use_id } = args;
    
    console.error(`🔐 APPROVAL REQUEST: tool=${tool_name}, input=${JSON.stringify(input)}, tool_use_id=${tool_use_id}`);
    console.error(`🔍 MCP: Pending approvals before start: ${this.permissionHandler.getPendingCount()}`);
    
    // Generate a unique request ID for polling
    const requestId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.error(`🔵 MCP: Starting polling-based approval for request ID: ${requestId}`);
    
    // Start the approval request (non-blocking)
    this.permissionHandler.startApprovalRequest(tool_name, input, tool_use_id, requestId);
    
    // Implement polling mechanism like CCO-MCP
    const startTime = Date.now();
    const pollInterval = 1000; // Poll every second
    const timeoutMs = 5 * 60 * 1000; // 5 minute timeout
    
    console.error(`🔵 MCP: Starting polling loop with ${timeoutMs}ms timeout`);
    
    let pollCount = 0;
    
    try {
      while (Date.now() - startTime < timeoutMs) {
        pollCount++;
        if (pollCount % 5 === 0) {  // Log every 5 seconds
          console.error(`🔄 MCP: Polling attempt ${pollCount} for ${requestId}`);
        }
        
        // Check if we have a response
        const approval = await this.permissionHandler.checkApprovalStatus(requestId);
        
        if (approval) {
          console.error(`📝 APPROVAL RESPONSE: ${JSON.stringify(approval)}`);
          
          // Clean up the request
          this.permissionHandler.cleanupApprovalRequest(requestId);
          
          // Claude Code expects a JSON-stringified payload with the complete decision
          const responsePayload = {
            behavior: approval.behavior,
            updatedInput: approval.updatedInput || input,
            ...(approval.message && { message: approval.message })
          };
          
          const responseText = JSON.stringify(responsePayload);
          
          console.error(`🎯 MCP: Returning to Claude Code: ${responseText}`);
          console.error(`🔍 MCP: Pending approvals after cleanup: ${this.permissionHandler.getPendingCount()}`);
          
          return {
            content: [
              {
                type: 'text',
                text: responseText,
              },
            ],
          };
        }
        
        // Still pending, wait before checking again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      
      // Timeout reached - deny the request
      console.error(`⏰ MCP: Request ${requestId} timed out after ${timeoutMs}ms (${pollCount} polls)`);
      
      // Clean up the timed out request
      this.permissionHandler.cleanupApprovalRequest(requestId);
      
      const timeoutResponse = JSON.stringify({
        behavior: 'deny',
        message: 'Request timed out waiting for approval'
      });
      
      return {
        content: [
          {
            type: 'text',
            text: timeoutResponse,
          },
        ],
      };
    } catch (error) {
      console.error(`❌ MCP: Error in approval polling for ${requestId}: ${error}`);
      
      // Clean up on error
      this.permissionHandler.cleanupApprovalRequest(requestId);
      
      const errorResponse = JSON.stringify({
        behavior: 'deny',
        message: 'Internal error during approval processing'
      });
      
      return {
        content: [
          {
            type: 'text',
            text: errorResponse,
          },
        ],
      };
    }
  }

  private setupErrorHandler() {
    this.server.onerror = (error) => {
      console.error('[MCP Server Error]', error);
    };
  }

  async run() {
    console.error('🚀 MCP Server: Starting connection process...');
    const transport = new StdioServerTransport();
    console.error('🚀 MCP Server: Created StdioServerTransport');
    await this.server.connect(transport);
    console.error(`🚀 MCP Server: Connected! Running for worktree: ${WORKTREE_ID}`);
    console.error('🚀 MCP Server: Ready to receive tool calls');
  }
}

// Start the server
const server = new OrchestraWorktreeMcpServer();
server.run().catch((error) => {
  console.error('Failed to run server:', error);
  process.exit(1);
});
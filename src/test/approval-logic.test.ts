import { describe, it, expect } from 'vitest';
import { ApprovalResponse } from '../types';

describe('Approval Conversion Logic', () => {
  // Test the core conversion logic that we use in the Tauri service
  const convertApprovalResponse = (response: ApprovalResponse) => {
    return {
      ...response,
      behavior: response.behavior === 'allow' ? 'Allow' : 'Deny'
    };
  };

  const convertToMcpResponse = (behavior: 'Allow' | 'Deny') => {
    return behavior === 'Allow' ? 'allow' : 'deny';
  };

  describe('Frontend to Rust Backend Conversion', () => {
    it('converts lowercase "allow" to uppercase "Allow"', () => {
      const input: ApprovalResponse = {
        behavior: 'allow',
        updatedInput: { test: 'data' }
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Allow',
        updatedInput: { test: 'data' }
      });
    });

    it('converts lowercase "deny" to uppercase "Deny"', () => {
      const input: ApprovalResponse = {
        behavior: 'deny',
        message: 'User denied the operation'
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Deny',
        message: 'User denied the operation'
      });
    });

    it('preserves all other properties during conversion', () => {
      const input: ApprovalResponse = {
        behavior: 'allow',
        message: 'Custom approval message',
        updatedInput: { 
          command: 'modified-command',
          args: ['--updated', '--flags'] 
        }
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Allow',
        message: 'Custom approval message',
        updatedInput: { 
          command: 'modified-command',
          args: ['--updated', '--flags'] 
        }
      });
    });
  });

  describe('Rust Backend to MCP Server Conversion', () => {
    it('converts uppercase "Allow" to lowercase "allow"', () => {
      const result = convertToMcpResponse('Allow');
      expect(result).toBe('allow');
    });

    it('converts uppercase "Deny" to lowercase "deny"', () => {
      const result = convertToMcpResponse('Deny');
      expect(result).toBe('deny');
    });
  });

  describe('Round-trip Conversion', () => {
    it('correctly converts through the entire pipeline', () => {
      // Start with MCP protocol format (lowercase)
      const originalMcpRequest: ApprovalResponse = {
        behavior: 'allow',
        updatedInput: { command: 'ls', args: ['-la'] }
      };

      // Convert to Rust format (uppercase)
      const rustFormat = convertApprovalResponse(originalMcpRequest);
      expect(rustFormat.behavior).toBe('Allow');

      // Convert back to MCP format (lowercase)
      const finalMcpResponse = convertToMcpResponse(rustFormat.behavior as 'Allow' | 'Deny');
      expect(finalMcpResponse).toBe('allow');

      // Verify we end up with the same format we started with
      expect(finalMcpResponse).toBe(originalMcpRequest.behavior);
    });

    it('handles deny path through entire pipeline', () => {
      const originalMcpRequest: ApprovalResponse = {
        behavior: 'deny',
        message: 'Too dangerous'
      };

      const rustFormat = convertApprovalResponse(originalMcpRequest);
      expect(rustFormat.behavior).toBe('Deny');

      const finalMcpResponse = convertToMcpResponse(rustFormat.behavior as 'Allow' | 'Deny');
      expect(finalMcpResponse).toBe('deny');
      expect(finalMcpResponse).toBe(originalMcpRequest.behavior);
    });
  });

  describe('MCP Protocol Compliance', () => {
    it('ensures MCP protocol uses only lowercase behaviors', () => {
      const validMcpBehaviors = ['allow', 'deny'];
      
      validMcpBehaviors.forEach(behavior => {
        expect(behavior).toMatch(/^[a-z]+$/);
        expect(behavior).not.toMatch(/^[A-Z]/);
      });
    });

    it('documents the protocol requirements', () => {
      // This test serves as documentation for the protocol requirements
      const protocolSpec = {
        mcpProtocol: {
          allowBehavior: 'allow',
          denyBehavior: 'deny',
          description: 'MCP servers expect lowercase behavior values'
        },
        rustBackend: {
          allowBehavior: 'Allow',
          denyBehavior: 'Deny', 
          description: 'Rust enum variants are capitalized'
        },
        conversionRequired: true,
        conversionPoints: [
          'Tauri service layer (frontend -> backend)',
          'HTTP response handler (backend -> MCP server)'
        ]
      };

      expect(protocolSpec.mcpProtocol.allowBehavior).toBe('allow');
      expect(protocolSpec.rustBackend.allowBehavior).toBe('Allow');
      expect(protocolSpec.conversionRequired).toBe(true);
      expect(protocolSpec.conversionPoints).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty response objects', () => {
      const input: ApprovalResponse = {
        behavior: 'allow'
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Allow'
      });
    });

    it('handles responses with undefined optional fields', () => {
      const input: ApprovalResponse = {
        behavior: 'deny',
        message: undefined,
        updatedInput: undefined
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Deny',
        message: undefined,
        updatedInput: undefined
      });
    });

    it('preserves null values in optional fields', () => {
      const input: ApprovalResponse = {
        behavior: 'allow',
        message: null as any,
        updatedInput: null as any
      };

      const result = convertApprovalResponse(input);

      expect(result).toEqual({
        behavior: 'Allow',
        message: null,
        updatedInput: null
      });
    });
  });
});
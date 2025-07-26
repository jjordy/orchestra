import '@testing-library/jest-dom';

// Mock TauriService with all required methods and default implementations
const mockTauriService = {
  // Worktree operations
  createWorktree: vi.fn().mockResolvedValue({
    id: 'test-worktree-id',
    name: 'Test Worktree',
    path: '/test/worktree',
    branch: 'test-branch',
    base_repo: '/test/repo',
    is_active: true,
    created_at: new Date().toISOString(),
  }),
  listWorktrees: vi.fn().mockResolvedValue([]),
  checkWorktreeStatus: vi.fn().mockResolvedValue([true, false]),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
  
  // Claude process operations
  startClaudeProcess: vi.fn().mockResolvedValue({
    id: 'test-process-id',
    worktree_id: 'test-worktree',
    pid: 12345,
    status: 'running',
    started_at: new Date().toISOString(),
  }),
  sendMessageToClaude: vi.fn().mockResolvedValue(undefined),
  stopClaudeProcess: vi.fn().mockResolvedValue(undefined),
  listProcesses: vi.fn().mockResolvedValue([]),
  
  // Git operations
  validateGitRepo: vi.fn().mockResolvedValue('/test/repo'),
  listGitWorktrees: vi.fn().mockResolvedValue([
    {
      path: '/test/repo',
      branch: 'main',
      is_main: true,
      is_bare: false,
      is_detached: false,
    }
  ]),
  
  // MCP Server operations
  createMcpServer: vi.fn().mockResolvedValue('test-server-id'),
  stopMcpServer: vi.fn().mockResolvedValue(undefined),
  listMcpServers: vi.fn().mockResolvedValue([]),
  getMcpServerStatus: vi.fn().mockResolvedValue(true),
  
  // Approval system
  requestToolApproval: vi.fn().mockResolvedValue('test-approval-id'),
  respondToApproval: vi.fn().mockResolvedValue(undefined),
  getPendingApprovals: vi.fn().mockResolvedValue([]),
  
  // PTY operations (missing from actual service but used by components)
  createWorktreePty: vi.fn().mockImplementation((ptyId) => Promise.resolve(ptyId)),
  writeToPty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
};

// Mock Tauri API
const mockInvoke = vi.fn();
const mockListen = vi.fn(() => Promise.resolve(() => {}));

// Default mock implementation that maps to tauriService
const defaultMockImplementation = async (command: string, ...args: any[]) => {
  // Map Tauri commands to service methods
  switch (command) {
    // Worktree operations
    case 'create_worktree': {
      const [arg] = args;
      return mockTauriService.createWorktree(arg?.repoPath, arg?.branchName, arg?.worktreeName);
    }
    case 'list_worktrees':
      return mockTauriService.listWorktrees();
    case 'check_worktree_status': {
      const [arg] = args;
      return mockTauriService.checkWorktreeStatus(arg?.worktreePath || arg);
    }
    case 'remove_worktree': {
      const [arg] = args;
      return mockTauriService.removeWorktree(arg?.worktreePath, arg?.repoPath, arg?.force);
    }
    
    // Claude process operations  
    case 'start_claude_process': {
      const [worktreePath, worktreeId, userMessage, permissionMode] = args;
      return mockTauriService.startClaudeProcess(worktreePath, worktreeId, userMessage, permissionMode);
    }
    case 'send_message_to_claude': {
      const [worktreePath, worktreeId, message, permissionMode] = args;
      return mockTauriService.sendMessageToClaude(worktreePath, worktreeId, message, permissionMode);
    }
    case 'stop_claude_process': {
      const [arg] = args;
      return mockTauriService.stopClaudeProcess(arg?.processId || arg);
    }
    case 'list_processes':
      return mockTauriService.listProcesses();
      
    // Git operations
    case 'validate_git_repo': {
      const [arg] = args;
      return mockTauriService.validateGitRepo(arg?.repoPath || arg);
    }
    case 'list_git_worktrees': {
      const [arg] = args;
      return mockTauriService.listGitWorktrees(arg?.repoPath || arg);
    }
      
    // MCP Server operations
    case 'create_mcp_server': {
      const [worktreeId, worktreePath] = args;
      return mockTauriService.createMcpServer(worktreeId, worktreePath);
    }
    case 'stop_mcp_server': {
      const [serverId] = args;
      return mockTauriService.stopMcpServer(serverId);
    }
    case 'list_mcp_servers':
      return mockTauriService.listMcpServers();
    case 'get_mcp_server_status': {
      const [serverId] = args;
      return mockTauriService.getMcpServerStatus(serverId);
    }
      
    // Approval system
    case 'request_tool_approval': {
      const [request] = args;
      return mockTauriService.requestToolApproval(request);
    }
    case 'respond_to_approval': {
      const [approvalId, response] = args;
      return mockTauriService.respondToApproval(approvalId, response);
    }
    case 'get_pending_approvals':
      return mockTauriService.getPendingApprovals();
      
    // PTY operations
    case 'create_worktree_pty':
    case 'create_pty': {
      const [arg] = args;
      const ptyId = arg?.ptyId || arg;
      return mockTauriService.createWorktreePty(ptyId);
    }
    case 'write_to_pty': {
      const [arg] = args;
      const ptyId = arg?.ptyId || args[0];
      const data = arg?.data || args[1];
      return mockTauriService.writeToPty(ptyId, data);
    }
    case 'close_pty': {
      const [arg] = args;
      const ptyId = arg?.ptyId || arg;
      return mockTauriService.closePty(ptyId);
    }
      
    default:
      console.warn(`Unhandled mock invoke command: ${command}`);
      return undefined;
  }
};

// Set up the default implementation
mockInvoke.mockImplementation(defaultMockImplementation);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

vi.mock('../services/tauri', () => ({
  tauriService: mockTauriService,
}));

// Mock DOM methods
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  value: vi.fn(),
  writable: true,
});

// Mock navigator.clipboard - only if not already defined
if (!Object.getOwnPropertyDescriptor(navigator, 'clipboard')) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
    configurable: true,
  });
}

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock window methods
Object.defineProperty(window, 'addEventListener', {
  value: vi.fn(),
  writable: true,
});

Object.defineProperty(window, 'removeEventListener', {
  value: vi.fn(),
  writable: true,
});

Object.defineProperty(window, 'dispatchEvent', {
  value: vi.fn(),
  writable: true,
});

// Mock Canvas for xterm.js
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: vi.fn(() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Array(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Array(4) })),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    clip: vi.fn(),
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    miterLimit: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    shadowColor: '',
    globalAlpha: 0,
    globalCompositeOperation: '',
    measureText: vi.fn(() => ({ width: 0 })),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  })),
  writable: true,
});

// Mock xterm.js
const mockTerminal = {
  open: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  clear: vi.fn(),
  onData: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  cols: 80,
  rows: 24,
  buffer: {
    active: {
      baseY: 0,
      cursorY: 0,
      cursorX: 0,
      viewportY: 0,
      length: 0,
    }
  }
};

// Create a proper mock constructor
const MockTerminal = vi.fn(() => mockTerminal);

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(() => ({})),
}));

// Mock getCurrentWindow
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    setTitle: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
  })),
}));

// Global test utilities
global.mockInvoke = mockInvoke;
global.mockListen = mockListen;
global.mockTerminal = mockTerminal;
global.MockTerminal = MockTerminal;
global.mockTauriService = mockTauriService;
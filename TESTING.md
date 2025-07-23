# Orchestra Manager - Test Suite Documentation

## Overview

This document describes the comprehensive test suite for Orchestra Manager, a cross-platform GUI application for managing git worktrees with embedded Claude Code instances.

## Test Architecture

### Frontend Tests (TypeScript/React)
- **Framework**: Vitest + React Testing Library
- **Location**: `src/test/`
- **Coverage**: Components, services, integration tests

### Backend Tests (Rust)
- **Framework**: Built-in Rust testing + tokio-test
- **Location**: `src-tauri/src/tests.rs`
- **Coverage**: PTY management, worktree operations, Claude processes

## Test Categories

### 1. Unit Tests

#### Terminal Component (`src/test/Terminal.test.tsx`)
- **Component Rendering**: Verifies terminal UI elements display correctly
- **PTY Session Management**: Tests session creation, reuse, and isolation
- **User Interactions**: Tests button clicks, keyboard input handling
- **Session Persistence**: Verifies state preservation across component lifecycles
- **Auto-launch Claude**: Tests Claude Code initialization for new/existing sessions
- **Error Handling**: Tests graceful failure handling

#### Tauri Service (`src/test/tauri.test.ts`)
- **Worktree Management**: CRUD operations for git worktrees
- **Claude Process Management**: Process lifecycle and communication
- **PTY Terminal Operations**: Terminal creation, I/O, and cleanup
- **Error Handling**: Network failures, timeouts, invalid inputs

#### Chat Window (`src/test/ChatWindow.test.tsx`)
- **Component Rendering**: Chat UI and message display
- **Header Actions**: Permission toggles, copy functionality
- **Message Sending**: User input processing and Claude integration
- **Process Status Display**: Status badges and indicators
- **Permission Modes**: Safe vs Full mode handling

### 2. Integration Tests

#### Multi-Component Integration (`src/test/integration.test.tsx`)
- **Terminal Session Isolation**: Separate PTY sessions per worktree
- **Chat-Terminal Integration**: Mode switching and state persistence
- **Multi-Worktree Parallel Operations**: Simultaneous terminal/chat sessions
- **Error Recovery**: Graceful handling of component failures

### 3. Backend Tests

#### Rust Backend (`src-tauri/src/tests.rs`)
- **Worktree Operations**: Git worktree creation and management
- **Claude Process Lifecycle**: Process spawning and monitoring
- **PTY Session Management**: Terminal session handling
- **JSON Message Parsing**: Claude Code output processing
- **State Management**: Application state consistency
- **Serialization**: Data structure serialization/deserialization

## Running Tests

### Quick Start
```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test

# Run backend tests only
cd src-tauri && cargo test

# Run comprehensive test suite
npm run test:run
```

### Test Commands

| Command | Description |
|---------|-------------|
| `npm run test` | Interactive test runner |
| `npm run test:run` | Run all tests once |
| `npm run test:ui` | Visual test interface |
| `npm run test:coverage` | Generate coverage report |
| `cargo test` | Run Rust backend tests |

### Test Configuration

#### Vitest Config (`vitest.config.ts`)
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
  },
});
```

#### Test Setup (`src/test/setup.ts`)
- Mocks Tauri API calls
- Mocks xterm.js terminal library
- Provides global test utilities
- Configures testing environment

## Test Coverage Areas

### ✅ Covered Features
1. **Terminal Component**
   - PTY session creation and management
   - User input handling and terminal output
   - Session persistence across component lifecycles
   - Claude Code auto-launch functionality
   - Error handling and recovery

2. **Chat Interface**
   - Message sending and receiving
   - Claude process integration
   - Permission mode handling
   - Status indicators and UI feedback

3. **Worktree Management**
   - Git worktree operations
   - Multi-worktree isolation
   - Session state management

4. **Backend Services**
   - PTY operations and lifecycle
   - Claude process spawning
   - JSON message parsing
   - State persistence

### 🔧 Areas for Future Testing
1. **Cross-Platform Compatibility**
   - Windows, macOS, Linux terminal behavior
   - Platform-specific PTY operations
   - File system path handling

2. **Performance Testing**
   - Large output buffer handling
   - Multiple simultaneous sessions
   - Memory usage optimization

3. **Security Testing**
   - Permission validation
   - Command injection prevention
   - File system access controls

## Mock Strategy

### Frontend Mocks
- **Tauri API**: All `invoke()` calls mocked with configurable responses
- **XTerm.js**: Terminal library mocked with spy functions
- **LocalStorage**: Browser storage mocked for state persistence tests
- **File System**: Path operations mocked for cross-platform compatibility

### Backend Mocks
- **Git Commands**: Mocked for consistent test environment
- **Claude Binary**: Mocked to avoid external dependencies
- **PTY System**: Conditionally mocked based on test environment

## Test Data

### Sample Worktrees
```typescript
const testWorktree = {
  id: 'test-worktree-1',
  name: 'Feature Branch',
  path: '/home/test/feature-branch',
  branch: 'feature-branch',
  base_repo: '/home/test/main-repo',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
};
```

### Sample Messages
```typescript
const testMessage = {
  id: 'msg-1',
  worktree_id: 'test-worktree-1',
  role: 'user',
  content: 'Hello Claude',
  timestamp: '2024-01-01T00:00:00Z',
  status: 'sent',
};
```

## CI/CD Integration

### GitHub Actions (Future)
```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
      - name: Setup Rust
        uses: actions-rs/toolchain@v1
      - name: Run Frontend Tests
        run: npm run test:run
      - name: Run Backend Tests
        run: cd src-tauri && cargo test
```

## Debugging Tests

### Common Issues
1. **Mock Setup**: Ensure mocks are properly configured in `setup.ts`
2. **Async Operations**: Use `waitFor()` for async state changes
3. **Component Cleanup**: Clear global state between tests
4. **Event Listeners**: Properly mock and cleanup event handlers

### Debug Commands
```bash
# Run specific test file
npm run test Terminal.test.tsx

# Run with verbose output
npm run test -- --reporter=verbose

# Debug individual test
npm run test -- --reporter=verbose -t "creates PTY session"
```

## Best Practices

### Test Writing
1. **AAA Pattern**: Arrange, Act, Assert
2. **Descriptive Names**: Clear test descriptions
3. **Isolated Tests**: No dependencies between tests
4. **Mock External Dependencies**: Avoid real API calls
5. **Test Edge Cases**: Error conditions and boundary values

### Maintenance
1. **Keep Tests Updated**: Match implementation changes
2. **Regular Review**: Remove obsolete tests
3. **Performance Monitoring**: Track test execution time
4. **Coverage Goals**: Maintain >80% code coverage

## Conclusion

This comprehensive test suite ensures Orchestra Manager's reliability, performance, and maintainability. The tests cover critical functionality including terminal management, chat integration, worktree operations, and error handling scenarios.

Regular execution of these tests during development helps maintain code quality and prevents regressions as new features are added.
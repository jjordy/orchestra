# GitHub Actions Workflows

This directory contains the CI/CD workflows for Orchestra Manager.

## Workflows

### 🧪 [`test.yml`](./test.yml)
Comprehensive testing workflow that runs on push and pull requests:
- **Frontend Tests**: React component tests using Vitest
- **Backend Tests**: Rust unit tests with Cargo
- **MCP Server Tests**: Node.js tests for the MCP server
- **Integration Tests**: Full build verification

### 🔄 [`ci.yml`](./ci.yml)
Continuous integration workflow with smart change detection:
- Only runs tests for changed components
- Includes linting and type checking
- Performs build verification
- Optimized for fast feedback

### 🚀 [`release.yml`](./release.yml)
Automated release workflow triggered by version tags:
- **Cross-platform builds**: Windows, macOS (Intel + Apple Silicon), Linux
- **Multiple formats**: 
  - Windows: `.exe` installer + `.msi`
  - macOS: `.dmg` for both architectures
  - Linux: `.AppImage` + `.deb` package
- **Automated release**: Creates GitHub release with all binaries

### 🔒 [`security.yml`](./security.yml)
Security scanning and dependency auditing:
- **Dependency audits**: npm audit for Node.js dependencies
- **Rust security**: cargo-audit for Rust crates
- **CodeQL analysis**: Static code analysis for vulnerabilities
- **Scheduled scans**: Weekly security checks

## Setup Requirements

### Required Secrets
Add these secrets to your GitHub repository settings:

```bash
# Tauri code signing (optional but recommended)
TAURI_PRIVATE_KEY=<your-private-key>
TAURI_KEY_PASSWORD=<your-key-password>
```

### Generating Tauri Signing Keys
```bash
# Generate a new keypair for code signing
npm run tauri signer generate -- --output ~/.tauri/myapp.key
```

### Branch Protection
Recommended branch protection rules for `main`:
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- ✅ Include administrators
- ✅ Required status checks:
  - `Test Frontend`
  - `Test Backend`  
  - `Test MCP Server`
  - `Build Check`

## Triggering Releases

To create a new release:

1. **Update version** in `src-tauri/tauri.conf.json`
2. **Commit changes**: `git commit -m "chore: bump version to v1.0.0"`
3. **Create and push tag**: 
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. **Monitor workflow**: The release workflow will automatically build and publish

## Local Development

### Running all tests locally:
```bash
# Run all test suites
npm run test:all

# Run with coverage
npm run test:all:coverage

# Run specific test suites
npm run test:run        # Frontend tests
npm run test:rust       # Backend tests  
npm run test:mcp        # MCP server tests
```

### Build verification:
```bash
# Frontend build
npm run build

# MCP server build
cd mcp-server && npm run build

# Full Tauri build
npm run tauri build
```

## Workflow Optimization

### Change Detection
The CI workflow uses [`dorny/paths-filter`](https://github.com/dorny/paths-filter) to only run tests for changed components, significantly reducing CI time.

### Caching Strategy
- **Node.js**: npm cache for faster dependency installation
- **Rust**: Cargo cache for compiled dependencies
- **Cross-platform**: Separate cache keys per OS

### Parallel Execution
- Tests run in parallel across different components
- Release builds happen simultaneously on all platforms
- Security scans run independently

## Troubleshooting

### Common Issues

**❌ Tauri build fails**
- Ensure system dependencies are installed (see workflow files)
- Check Tauri signing configuration
- Verify `tauri.conf.json` is valid

**❌ Tests timeout**
- Increase timeout in workflow if needed
- Check for hanging processes in tests
- Verify test isolation

**❌ Release upload fails**
- Check binary paths match expected names
- Ensure version extraction works correctly
- Verify GitHub token permissions

### Debug Mode
Add `ACTIONS_STEP_DEBUG: true` to workflow environment variables for detailed logs.

## Contributing

When adding new workflows:
1. Follow existing naming conventions
2. Include proper error handling
3. Add appropriate caching
4. Document any new secrets or setup requirements
5. Test workflows on a fork first
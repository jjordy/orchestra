# 🎼 Orchestra Manager

A cross-platform GUI application for managing multiple Claude Code instances across git worktrees, enabling parallel AI development workflows.

## ✨ Features

- **🌳 Git Worktree Management**: Create, list, and remove git worktrees with custom branch names
- **🤖 Claude Code Process Management**: Start and monitor multiple Claude Code instances
- **📋 Task Assignment**: Assign specific tasks to individual Claude processes
- **📊 Real-time Monitoring**: Track process status, activity, and performance
- **🎨 Modern UI**: Clean, responsive interface built with React and TypeScript
- **⚡ Cross-Platform**: Runs on Linux, Windows, and macOS

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **Rust** (latest stable)
- **Git** (for worktree operations)
- **System Dependencies** (Linux only):
  ```bash
  # Ubuntu/Debian
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  
  # Arch Linux
  sudo pacman -S webkit2gtk gtk3 libayatana-appindicator librsvg
  
  # Fedora
  sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel
  ```

### Installation

1. **Navigate to the project directory**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Run in development mode**:
   ```bash
   # For most systems:
   npm run tauri dev
   
   # For Wayland/Linux systems (if you get a blank window):
   WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev
   ```

## 🏗️ Architecture

### Frontend (React + TypeScript)
- **Components**: Modular React components for worktree and process management
- **Services**: Tauri API integration layer
- **Types**: Comprehensive TypeScript type definitions
- **Styling**: CSS modules with responsive design

### Backend (Rust + Tauri)
- **Commands**: Async Tauri commands for git operations and process management
- **State Management**: Thread-safe application state with Mutex
- **Git Integration**: Direct git command execution for worktree operations
- **Error Handling**: Comprehensive error handling and user feedback

## 📁 Project Structure

```
orchestra-manager/
├── src/                          # React Frontend
│   ├── components/
│   │   ├── WorktreeManager.tsx   # Worktree management UI
│   │   └── ProcessManager.tsx    # Process management UI
│   ├── services/
│   │   └── tauri.ts             # Tauri API integration
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── App.tsx                  # Main application component
│   └── App.css                  # Application styles
├── src-tauri/                   # Rust Backend
│   ├── src/
│   │   ├── lib.rs              # Tauri commands and state
│   │   └── main.rs             # Application entry point
│   ├── Cargo.toml              # Rust dependencies
│   └── tauri.conf.json         # Tauri configuration
├── package.json                # Node.js dependencies and scripts
└── README.md                   # This file
```

## 🎯 Usage

### Creating Worktrees

1. Click **"Create New Worktree"** in the Worktrees tab
2. Enter the **repository path** (path to your existing git repository)
3. Specify a **branch name** for the new worktree
4. Provide a **worktree name** for identification
5. Click **"Create Worktree"**

### Managing Claude Processes

1. Switch to the **"Processes"** tab
2. Click **"Start New Process"**
3. Select a **worktree** from the dropdown
4. Optionally add a **task description**
5. Click **"Start Process"**

### Monitoring

- **Real-time Updates**: Use the "Refresh" button to update data
- **Status Indicators**: Color-coded status for worktrees and processes
- **Activity Tracking**: Monitor start times and last activity

## 🔧 Development

### Available Scripts

- `npm run dev` - Start frontend development server
- `npm run build` - Build frontend for production
- `npm run tauri dev` - Run full Tauri application in development
- `npm run tauri build` - Build production application

### Building for Production

```bash
npm run tauri build
```

This creates platform-specific binaries in `src-tauri/target/release/bundle/`

## 🚧 Roadmap

### ✅ Completed Features
- [x] **Claude Code Integration**: Real Claude Code process spawning with stream JSON parsing
- [x] **Git Worktree Management**: Full git worktree operations (create, list, remove)
- [x] **Real-time Process Monitoring**: Live status tracking and output streaming
- [x] **Terminal Integration**: Persistent PTY sessions with xterm.js interface
- [x] **Chat Interface**: Full chat UI with message history and status indicators
- [x] **Permission Modes**: Safe and full permission modes for Claude processes
- [x] **Cross-platform Support**: Linux, Windows, and macOS compatibility

### 🔄 In Progress / Enhancements
- [ ] **Enhanced Logging**: File-based logging with rotation and search capabilities
- [ ] **Advanced Configuration**: Central config file and settings UI
- [ ] **Error Recovery**: Automatic process restart and connection retry logic
- [ ] **Performance Monitoring**: Resource usage and CPU/memory tracking

### 📋 Future Features
- [ ] **Task Queue System**: Queue management for multiple Claude operations
- [ ] **Export/Import**: Comprehensive backup and restore functionality
- [ ] **Theme Customization**: Dark mode and custom UI themes
- [ ] **Plugin System**: Extensibility for custom integrations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- **Tauri** - For the excellent cross-platform framework
- **React** - For the powerful frontend library
- **Rust** - For the performant and safe backend language
- **Claude Code** - For the AI development platform this tool orchestrates

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

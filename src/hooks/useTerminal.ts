import { useRef, useEffect, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export interface TerminalConfig {
  theme?: Record<string, string>;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  cursorBlink?: boolean;
}

const DEFAULT_THEME = {
  background: '#111827',
  foreground: '#ffffff',
  cursor: '#ffffff',
  black: '#1f2937',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#f3f4f6',
  brightBlack: '#4b5563',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

const DEFAULT_CONFIG: TerminalConfig = {
  theme: DEFAULT_THEME,
  fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
  fontSize: 14,
  lineHeight: 1.2,
  cursorBlink: true,
};

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement>,
  config: TerminalConfig = DEFAULT_CONFIG
) {
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const xterm = new XTerm({
      theme: config.theme || DEFAULT_THEME,
      fontFamily: config.fontFamily || DEFAULT_CONFIG.fontFamily,
      fontSize: config.fontSize || DEFAULT_CONFIG.fontSize,
      lineHeight: config.lineHeight || DEFAULT_CONFIG.lineHeight,
      cursorBlink: config.cursorBlink ?? DEFAULT_CONFIG.cursorBlink,
      convertEol: true,
      disableStdin: false,
      allowProposedApi: true,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    
    // Open terminal
    xterm.open(containerRef.current);
    fitAddon.fit();

    // Store references
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Mark as ready after terminal is fully initialized
    setIsReady(true);

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      try {
        xterm.dispose();
      } catch (error) {
        console.error('Error disposing terminal:', error);
      }
      
      // Clear any remaining DOM elements
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      
      xtermRef.current = null;
      fitAddonRef.current = null;
      setIsReady(false);
    };
  }, []);

  const write = (data: string) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  };

  const writeln = (data: string) => {
    if (xtermRef.current) {
      xtermRef.current.writeln(data);
    }
  };

  const clear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  };

  const onData = (handler: (data: string) => void) => {
    if (xtermRef.current) {
      xtermRef.current.onData(handler);
    }
  };

  const fit = () => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  };

  return {
    terminal: xtermRef.current,
    isReady,
    write,
    writeln,
    clear,
    onData,
    fit,
  };
}
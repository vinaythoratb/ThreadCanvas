
import React, { useState } from 'react';
import { X, Terminal, Copy, Check, Monitor, Command } from 'lucide-react';

interface OllamaGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OllamaGuide: React.FC<OllamaGuideProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                <Terminal size={20} />
            </div>
            <div>
                <h2 className="text-lg font-bold text-gray-800">Setup Local Ollama</h2>
                <p className="text-xs text-gray-500">Enable CORS to allow browser connection</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-black/5 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
            <div className="text-sm text-gray-600 leading-relaxed">
                <p>
                    To use your local LLMs, you must restart your Ollama server with the 
                    <code className="mx-1.5 px-1.5 py-0.5 bg-gray-100 rounded text-gray-800 font-mono text-xs">OLLAMA_ORIGINS="*"</code> 
                    environment variable. This allows this web app to communicate with your localhost.
                </p>
            </div>

            {/* Mac / Linux */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wide">
                    <Command size={12} />
                    <span>Mac & Linux</span>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 group relative">
                    <code className="font-mono text-xs text-green-400 block break-all">
                        OLLAMA_ORIGINS="*" ollama serve
                    </code>
                    <CopyButton text='OLLAMA_ORIGINS="*" ollama serve' />
                </div>
            </div>

            {/* Windows */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wide">
                    <Monitor size={12} />
                    <span>Windows (PowerShell)</span>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 group relative">
                    <code className="font-mono text-xs text-blue-400 block break-all">
                        $env:OLLAMA_ORIGINS="*"; ollama serve
                    </code>
                    <CopyButton text='$env:OLLAMA_ORIGINS="*"; ollama serve' />
                </div>
            </div>

            <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 flex gap-3">
                <div className="text-orange-500 mt-0.5">⚠️</div>
                <div className="text-xs text-orange-800">
                    <span className="font-bold">Troubleshooting:</span> If you are already running Ollama in the background (e.g., system tray), you must <strong>quit it first</strong> before running the command above.
                </div>
            </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
            <button 
                onClick={onClose}
                className="w-full py-2.5 bg-gray-900 hover:bg-black text-white rounded-lg font-medium text-sm transition-all shadow-lg hover:shadow-xl active:scale-[0.98]"
            >
                I've run the command
            </button>
        </div>
      </div>
    </div>
  );
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button 
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded transition-all"
            title="Copy command"
        >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
    );
};

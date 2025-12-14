
import React, { useState, useEffect, useMemo } from 'react';
import { Chapter, Message, MessageCategory } from '../types';
import { ChevronRight, Search, Clock, MessageSquare, HelpCircle, ChevronUp, GitFork, CornerDownRight, ChevronDown } from 'lucide-react';
import { BackendType, AVAILABLE_GEMINI_MODELS } from '../services/gemini';

interface SidebarProps {
  chapters: Chapter[];
  currentThreadMessages: Message[];
  allMessages: Message[]; // NEW: Needed to detect branch parents
  onNavigate: (msgId: string) => void;
  activeMessageId: string | null;
  activeChapterId?: string; 
  backendType: BackendType;
  onToggleBackend?: () => void;
  preferredBackend?: 'GEMINI' | 'OLLAMA';
  selectedModelId?: string;
  onSelectModel?: (id: string) => void;
  onShowOllamaHelp?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    chapters, 
    currentThreadMessages,
    allMessages,
    onNavigate, 
    activeMessageId, 
    activeChapterId, 
    backendType, 
    onToggleBackend, 
    preferredBackend,
    selectedModelId,
    onSelectModel,
    onShowOllamaHelp
}) => {
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);

  // Optimization: Create a Map for O(1) message lookups during traversal
  const messageMap = useMemo(() => {
      return new Map(allMessages.map(m => [m.id, m]));
  }, [allMessages]);

  // Filter and organize chapters: Show Active Thread + All Ancestral Offshoots
  const displayedChapters = useMemo(() => {
    const activeThreadIds = new Set(currentThreadMessages.map(m => m.id));

    // 1. Identify chapters to show
    const relevantChapters = chapters.filter(c => {
        // Case A: Strictly part of the active thread (Active Path)
        if (activeThreadIds.has(c.startMessageId)) return true;

        // Case B: Search Match overrides structure
        if (searchQuery.trim()) {
             const lower = searchQuery.toLowerCase();
             return c.title.toLowerCase().includes(lower) || c.subtopics.some(s => s.toLowerCase().includes(lower));
        }

        // Case C: Ancestry Check (Recursive)
        // Does this chapter branch off from ANY point in the current active thread?
        // We walk up the tree from the chapter start. If we hit a message that 
        // is part of the active thread, this chapter is a relevant offshoot/branch.
        let curr: Message | undefined = messageMap.get(c.startMessageId);
        let hops = 0;
        
        while (curr && hops < 500) { // Safety limit for deep trees
            if (activeThreadIds.has(curr.id)) {
                return true; // Found connection to active thread
            }
            if (!curr.parentId) break;
            curr = messageMap.get(curr.parentId);
            hops++;
        }

        return false;
    });

    // 2. Sort by chronological order of their start message
    return relevantChapters.sort((a, b) => {
         const msgA = messageMap.get(a.startMessageId);
         const msgB = messageMap.get(b.startMessageId);
         return (msgA?.timestamp || 0) - (msgB?.timestamp || 0);
    });
  }, [chapters, searchQuery, currentThreadMessages, messageMap]);

  // Auto-expand active chapter on scroll
  useEffect(() => {
      if (activeChapterId) {
          setExpandedChapters(prev => {
              const newSet = new Set(prev);
              newSet.add(activeChapterId);
              return newSet;
          });
      }
  }, [activeChapterId]);

  // Auto-expand last on load
  useEffect(() => {
     if (displayedChapters.length > 0 && expandedChapters.size === 0) {
       setExpandedChapters(new Set([displayedChapters[displayedChapters.length-1].id]));
    }
  }, [displayedChapters.length]);

  const toggleChapter = (id: string) => {
    const newSet = new Set(expandedChapters);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedChapters(newSet);
  };

  const activeModelLabel = useMemo(() => {
     if (preferredBackend === 'OLLAMA') return 'Local (Llama/Mistral)';
     const found = AVAILABLE_GEMINI_MODELS.find(m => m.id === selectedModelId);
     return found ? found.label : 'Flash Lite (Default)';
  }, [preferredBackend, selectedModelId]);

  return (
    <div className="w-[280px] flex-shrink-0 bg-[#FAFAF9] border-r border-gray-200 h-full flex flex-col pt-6 overflow-hidden font-sans">
      
      {/* Header & Search */}
      <div className="px-5 mb-6 space-y-4">
        <h2 className="text-[11px] font-bold text-gray-400 tracking-widest uppercase flex items-center gap-2">
            Conversation Stack
        </h2>
        <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
            <input 
                type="text" 
                placeholder="Search topics..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-xs focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100 transition-all placeholder-gray-400 font-medium"
            />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6 custom-scrollbar">
        {displayedChapters.length === 0 ? (
            <div className="py-12 text-center text-gray-400 flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <Clock size={16} className="opacity-40"/>
                </div>
                <span className="text-xs font-medium opacity-60">Timeline is empty</span>
            </div>
        ) : (
            <div className="space-y-3 pb-10">
                {/* Visual Stack: Connected Line */}
                <div className="absolute left-[26px] top-0 bottom-0 w-[1px] bg-gray-200/50 z-0 pointer-events-none"></div>

                {displayedChapters.map((chapter) => {
                    const isExpanded = expandedChapters.has(chapter.id);
                    const isActiveChapter = chapter.id === activeChapterId;
                    const isActivePath = currentThreadMessages.some(m => m.id === chapter.startMessageId);
                    
                    // Visual States
                    const isBranch = !isActivePath;

                    let cardClasses = "rounded-xl border transition-all duration-300 overflow-hidden relative z-10 ";
                    
                    if (isBranch) {
                        // Inactive / Alternative Branch Styling
                        cardClasses += "bg-gray-50/80 border-dashed border-gray-300 opacity-80 hover:opacity-100 hover:border-gray-400 hover:bg-white hover:shadow-sm";
                    } else if (isActiveChapter) {
                        // Currently Reading Chapter
                        cardClasses += "bg-white border-claude-accent/30 shadow-md ring-1 ring-claude-accent/20";
                    } else {
                        // Active Path (but not current chapter)
                        cardClasses += "bg-white border-gray-200 shadow-sm opacity-90 hover:opacity-100 hover:border-gray-300";
                    }

                    return (
                        <div key={chapter.id} className={cardClasses}>
                            {/* Card Header - PRIMARY ACTION: Navigate */}
                            <div 
                                className={`
                                    px-3 py-2.5 cursor-pointer flex flex-col gap-1.5
                                    ${isActiveChapter ? 'bg-gradient-to-r from-teal-50/50 to-transparent' : ''}
                                `}
                                onClick={() => onNavigate(chapter.startMessageId)}
                            >
                                <div className="flex items-center gap-2">
                                     {/* SECONDARY ACTION: Expand/Collapse */}
                                     <button 
                                        onClick={(e) => { e.stopPropagation(); toggleChapter(chapter.id); }}
                                        className="p-1 -ml-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 rounded transition-colors z-20 relative"
                                        title={isExpanded ? "Collapse" : "Expand"}
                                     >
                                         <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                            {isBranch ? <CornerDownRight size={12} /> : <ChevronRight size={12} />}
                                        </div>
                                    </button>
                                    
                                    <h3 
                                        className={`text-xs font-semibold leading-tight transition-colors flex-1 select-none flex items-center gap-1.5
                                            ${isActiveChapter ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'}
                                            ${isBranch ? 'italic text-gray-500' : ''}
                                        `}
                                    >
                                        {chapter.title}
                                        {isBranch && <GitFork size={10} className="text-gray-400" />}
                                    </h3>
                                </div>
                                
                                {/* Meta Badges */}
                                <div className="flex items-center gap-2 pl-6">
                                     <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                                        <MessageSquare size={10} /> {chapter.messageCount}
                                     </span>
                                     {isBranch && (
                                         <span className="text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
                                             Branch
                                         </span>
                                     )}
                                </div>
                            </div>

                            {/* Subtopics (Internal Hierarchy) */}
                            <div className={`
                                transition-all duration-300 ease-in-out bg-gray-50/50 border-t border-gray-100
                                ${isExpanded ? 'opacity-100 max-h-[500px] py-2' : 'opacity-0 max-h-0 overflow-hidden'}
                            `}>
                                <div className="relative pl-7 space-y-1.5 pr-2">
                                    {/* Mini Spine for subtopics only */}
                                    <div className="absolute left-[15px] top-0 bottom-0 w-[1px] bg-gray-200/50"></div>
                                    
                                    {chapter.subtopics.map((sub, i) => (
                                        <div key={i} className="relative flex items-center gap-2 group/sub cursor-default">
                                            {/* Connector line */}
                                            <div className="absolute -left-[12px] top-1/2 w-2 h-[1px] bg-gray-200"></div>
                                            <div className="w-1 h-1 rounded-full bg-gray-300 group-hover/sub:bg-claude-accent transition-colors"></div>
                                            <span className="text-[11px] text-gray-500 font-medium group-hover/sub:text-gray-700 transition-colors line-clamp-1 break-all">
                                                {sub}
                                            </span>
                                        </div>
                                    ))}
                                    {chapter.subtopics.length === 0 && (
                                        <span className="text-[10px] text-gray-400 italic pl-1">No details yet...</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        )}
      </div>
      
      {/* Footer Area with Model Selection */}
      <div className="p-4 border-t border-gray-200 bg-white relative z-20">
        
        {/* Model Menu Popover */}
        {showModelMenu && preferredBackend === 'GEMINI' && (
            <div className="absolute bottom-[calc(100%+8px)] left-4 right-4 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden animate-slide-in-up z-50 ring-1 ring-black/5">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Select Model
                </div>
                {AVAILABLE_GEMINI_MODELS.map(model => (
                    <button
                        key={model.id}
                        onClick={() => { onSelectModel?.(model.id); setShowModelMenu(false); }}
                        className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-gray-50 transition-colors ${selectedModelId === model.id ? 'text-claude-accent font-medium bg-teal-50/30' : 'text-gray-600'}`}
                    >
                        <span>{model.label}</span>
                        {selectedModelId === model.id && <div className="w-1.5 h-1.5 rounded-full bg-claude-accent"></div>}
                    </button>
                ))}
            </div>
        )}

        <div className="flex flex-col gap-3">
            {/* Backend Toggle */}
            <div className="flex items-center justify-between text-[11px] text-gray-500 select-none">
                <div 
                    onClick={onToggleBackend}
                    className="flex-1 flex items-center gap-2.5 cursor-pointer hover:bg-gray-50 py-1.5 px-2 rounded-lg -ml-2 transition-all group border border-transparent hover:border-gray-200" 
                    title={`Click to switch. Preferred: ${preferredBackend}`}
                >
                    <div className={`w-2 h-2 rounded-full ring-2 ring-white shadow-sm transition-colors ${
                        backendType === 'GEMINI' ? 'bg-blue-500' :
                        backendType === 'OLLAMA' ? 'bg-orange-500' : 'bg-gray-300'
                    } ${backendType !== 'SIMULATION' ? 'animate-pulse' : ''}`}></div>
                    
                    <div className="flex items-center gap-1.5 font-semibold">
                        {backendType === 'GEMINI' && (
                            <>
                                <span className="text-gray-700">Gemini Cloud</span>
                            </>
                        )}
                        {backendType === 'OLLAMA' && (
                            <>
                                <span className="text-gray-700">Local Ollama</span>
                            </>
                        )}
                        {backendType === 'SIMULATION' && (
                            <>
                                <span>Simulation</span>
                            </>
                        )}
                    </div>
                </div>
                
                {/* Help Icon */}
                <button 
                    onClick={onShowOllamaHelp}
                    className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                    title="How to connect Ollama?"
                >
                    <HelpCircle size={15} />
                </button>
            </div>

            {/* Model Selector Trigger */}
            {preferredBackend === 'GEMINI' && (
                <button 
                    onClick={() => setShowModelMenu(!showModelMenu)}
                    className="flex items-center justify-between w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-100 transition-all group"
                >
                    <span className="text-[11px] font-semibold text-gray-600 group-hover:text-gray-800 truncate">
                        {activeModelLabel}
                    </span>
                    {showModelMenu ? <ChevronDown size={14} className="text-gray-400"/> : <ChevronUp size={14} className="text-gray-400"/>}
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

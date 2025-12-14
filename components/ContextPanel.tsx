import React from 'react';
import { ContextItem } from '../types';
import { X, Pin, Backpack } from 'lucide-react';

interface ContextPanelProps {
  pinnedItems: ContextItem[];
  onUnpin: (id: string) => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ pinnedItems, onUnpin }) => {
  return (
    <div className="w-[300px] flex-shrink-0 bg-white border-l border-claude-border h-full flex flex-col overflow-hidden">
      
      {/* SECTION 1: THE BACKPACK (PINNED ITEMS) */}
      <div className="flex-1 overflow-y-auto bg-claude-secondary/30 p-5">
        <div className="mb-4">
            <h2 className="text-xs font-bold text-claude-accent tracking-wider uppercase flex items-center gap-2">
            <Backpack size={14} />
            Context Backpack
            </h2>
            <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                Items pinned here are available across all branches (Cross-Pollination).
            </p>
        </div>
        
        {pinnedItems.length === 0 ? (
             <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center">
                 <Pin size={24} className="text-gray-300 mb-3" />
                 <p className="text-xs text-gray-400 font-medium">Your backpack is empty</p>
                 <p className="text-[10px] text-gray-400 mt-1 max-w-[150px]">Pin messages from any branch to carry context with you.</p>
             </div>
        ) : (
            <div className="space-y-2">
                {pinnedItems.map(item => (
                    <div key={item.id} className="relative group bg-white border border-blue-100 shadow-sm rounded-lg p-3 transition-all hover:border-claude-accent hover:shadow-md">
                        <button 
                            onClick={() => onUnpin(item.id)}
                            className="absolute top-2 right-2 text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={12} />
                        </button>
                        <div className="flex items-start gap-2">
                             <Pin size={12} className="text-claude-accent mt-1 flex-shrink-0" />
                             <div>
                                 <p className="text-xs font-medium text-gray-800 line-clamp-3">{item.content || item.label}</p>
                                 <p className="text-[9px] text-gray-400 mt-1.5">Pinned at {new Date(item.addedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                             </div>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};
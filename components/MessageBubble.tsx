import React from 'react';
import { Author, Message } from '../types';
import { GitBranch, Copy, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, RotateCw, Edit2, CornerDownRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  message: Message;
  onBranch: (messageId: string) => void;
  onSwipeBranch?: (messageId: string, direction: 'prev' | 'next') => void;
  isHead?: boolean;
  parentContent?: string;
  slideDirection?: 'left' | 'right'; 
  prevSibling?: Message;
  nextSibling?: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ 
    message, 
    onBranch, 
    onSwipeBranch, 
    isHead, 
    parentContent,
    slideDirection = 'right'
}) => {
  const isUser = message.author === Author.USER;
  const isGhost = message.id === 'ghost-draft';
  const hasSiblings = (message.siblingCount || 0) > 1;

  // Determine animation class based on direction
  const animationClass = slideDirection === 'left' ? 'animate-slide-in-left' : 'animate-slide-in-right';

  // --- BRANCH HEADER COMPONENT ---
  const BranchHeader = () => {
    // Show header if there are siblings OR if we are in ghost draft mode OR if explicitly marked as a branch start
    if (!hasSiblings && !isGhost && !message.branchId) return null;
    
    const count = message.siblingCount || 1;
    const index = message.siblingIndex || 1;
    
    return (
      <div className="w-full flex items-center justify-center gap-4 my-6 animate-fade-in select-none opacity-80 hover:opacity-100 transition-opacity group/header relative z-10">
        <div className="h-[1px] w-16 sm:w-24 bg-gradient-to-r from-transparent via-gray-200 to-gray-200"></div>
        
        <div className="flex items-center gap-3 relative z-20">
             <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium max-w-[150px] sm:max-w-none">
                <CornerDownRight size={14} className="text-claude-accent/70" />
                <span className="hidden sm:inline">Branched from</span>
                <span className="truncate italic text-gray-500">
                    "{parentContent?.slice(0, 20) || 'previous'}..."
                </span>
             </div>
             
             {/* Navigation Counter with Arrows - Only show if we actually have siblings to navigate to */}
             {count > 1 && (
                 <div className="flex items-center gap-2 ml-2 bg-white border border-gray-200 rounded-lg shadow-sm px-1.5 py-0.5">
                    <button 
                        onClick={() => onSwipeBranch && onSwipeBranch(message.id, 'prev')}
                        className="p-1.5 text-gray-400 hover:text-claude-accent hover:bg-teal-50 rounded transition-colors"
                        title="Previous branch"
                    >
                        <ChevronLeft size={12} />
                    </button>
                    <span className="text-[11px] text-gray-600 font-mono min-w-[24px] text-center font-semibold select-none">
                        {index} <span className="text-gray-300 mx-0.5">/</span> {count}
                    </span>
                    <button 
                        onClick={() => onSwipeBranch && onSwipeBranch(message.id, 'next')}
                        className="p-1.5 text-gray-400 hover:text-claude-accent hover:bg-teal-50 rounded transition-colors"
                        title="Next branch"
                    >
                        <ChevronRight size={12} />
                    </button>
                </div>
             )}
        </div>
        
        <div className="h-[1px] w-16 sm:w-24 bg-gradient-to-l from-transparent via-gray-200 to-gray-200"></div>
      </div>
    );
  };

  // Render User Message
  if (isUser) {
    // If it's a ghost draft, render a placeholder bubble
    const bubbleContent = isGhost ? (
        <div className="max-w-[85%] w-full flex justify-end">
            <div className="bg-transparent border-2 border-dashed border-gray-300 text-gray-400 px-5 py-3.5 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed font-serif animate-pulse select-none flex items-center justify-center min-w-[200px]">
                 <p className="text-gray-400 font-medium">Type to start new branch...</p>
            </div>
        </div>
    ) : (
      <div className={`w-full flex flex-col items-end ${isHead ? 'mb-4' : 'mb-8'} ${hasSiblings ? animationClass : ''}`}>
        
        <div className="max-w-[85%] group relative">
          <div className="bg-claude-userBubble text-claude-text px-5 py-3.5 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed font-serif shadow-sm border border-transparent hover:border-gray-200/50 transition-colors">
             <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          {/* Subtle edit button for user */}
          <div className="absolute top-2 -left-10 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
                onClick={() => onBranch(message.id)} 
                className="p-2 text-gray-400 hover:text-claude-accent rounded hover:bg-black/5"
                title="Edit to branch"
            >
                <Edit2 size={14} />
            </button>
          </div>
        </div>
      </div>
    );

    return (
        <>
            <BranchHeader />
            {bubbleContent}
        </>
    );
  }

  // Render AI Message
  return (
    <div className={`w-full flex flex-col ${isHead ? 'mb-4' : 'mb-8'} ${hasSiblings ? animationClass : ''}`}>
      <BranchHeader />

      <div className="flex w-full group">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-claude-accent text-white flex items-center justify-center mr-4 flex-shrink-0 mt-1 shadow-sm select-none">
            <span className="font-serif font-bold text-xs">AI</span>
        </div>

        <div className="flex-1 max-w-[90%]">
            {/* Content */}
            <div className="text-claude-text text-[15px] leading-relaxed font-serif markdown-content min-h-[40px]">
                <ReactMarkdown
                    components={{
                        p: ({node, ...props}) => <p className="mb-3 last:mb-0" {...props} />,
                        strong: ({node, ...props}) => <strong className="font-bold text-gray-800" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1" {...props} />,
                        h3: ({node, ...props}) => <h3 className="font-bold text-base mt-4 mb-2" {...props} />,
                        code: ({node, ...props}) => <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-gray-800" {...props} />
                    }}
                >
                    {message.content}
                </ReactMarkdown>
            </div>

            {/* Footer Action Row */}
            <div className="flex items-center gap-1 mt-2 min-h-[32px] relative z-10">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded hover:bg-black/5 transition-colors" title="Copy">
                        <Copy size={15} />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded hover:bg-black/5 transition-colors" title="Retry">
                        <RotateCw size={15} />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded hover:bg-black/5 transition-colors">
                        <ThumbsUp size={15} />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded hover:bg-black/5 transition-colors">
                        <ThumbsDown size={15} />
                    </button>

                    <div className="h-3 w-[1px] bg-gray-300 mx-2"></div>

                    {/* Branch Button */}
                    <button 
                        onClick={() => onBranch(message.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-claude-accent hover:bg-claude-accent/10 rounded transition-colors group/branch"
                        title="Fork conversation from here"
                    >
                        <GitBranch size={15} className="group-hover/branch:rotate-90 transition-transform duration-300"/>
                        <span>Branch</span>
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Paperclip, Share, Plus, Sparkles, ArrowUp, Clock } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { INITIAL_MESSAGES, ROOT_MESSAGE } from './constants';
import { Message, Author, MessageCategory, Chapter } from './types';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { Button } from './components/Button';
import { CanvasView } from './components/CanvasView';
import { streamResponse, analyzeTopicShift, BackendType, AVAILABLE_GEMINI_MODELS } from './services/gemini';
import { OllamaGuide } from './components/OllamaGuide';

const App = () => {
  // --- Core State ---
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [activeBranchHeadId, setActiveBranchHeadId] = useState<string>(ROOT_MESSAGE.id);
  const [viewMode, setViewMode] = useState<'LINEAR' | 'CANVAS'>('LINEAR');
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showCanvasTip, setShowCanvasTip] = useState(false);
  
  const [backendType, setBackendType] = useState<BackendType>('SIMULATION');
  const [preferredBackend, setPreferredBackend] = useState<'GEMINI' | 'OLLAMA'>('OLLAMA'); // Default to OLLAMA per user request
  const [showOllamaHelp, setShowOllamaHelp] = useState(false);
  
  // Default to the first (Cheapest) model in the list: 'gemini-flash-lite-latest'
  const [selectedModelId, setSelectedModelId] = useState<string>(AVAILABLE_GEMINI_MODELS[0].id);

  const containerScale = useMotionValue(1);
  const containerOpacity = useTransform(containerScale, [0.6, 1], [0, 1]);
  const containerRadius = useTransform(containerScale, [0.95, 1], [32, 0]);
  const containerY = useTransform(containerScale, [0.5, 1], [50, 0]);

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  
  const [isDraftingBranch, setIsDraftingBranch] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right'>('right');
  const [isExtendedThinking, setIsExtendedThinking] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const linearViewRef = useRef<HTMLDivElement>(null);

  const isNewChat = activeBranchHeadId === ROOT_MESSAGE.id && !isDraftingBranch;

  // --- 1. Thread Traversal Logic ---
  const currentThread = useMemo(() => {
    const thread: Message[] = [];
    let currentId: string | null = activeBranchHeadId;
    let loopSafety = 0;
    const MAX_DEPTH = 5000;
    
    while (currentId && loopSafety < MAX_DEPTH) {
      loopSafety++;
      const msg = messages.find(m => m.id === currentId);
      if (msg) {
        if (msg.id !== ROOT_MESSAGE.id) {
            thread.unshift(msg);
        }
        currentId = msg.parentId;
      } else {
        break;
      }
    }

    if (isDraftingBranch) {
        const ghostMsg: Message = {
            id: 'ghost-draft',
            parentId: activeBranchHeadId,
            author: Author.USER,
            content: '',
            timestamp: Date.now()
        };
        thread.push(ghostMsg);
    }

    return thread.map(msg => {
        if (!msg.parentId) return msg;
        
        let siblings = messages.filter(m => m.parentId === msg.parentId);
        siblings.sort((a, b) => a.timestamp - b.timestamp);
        
        if (isDraftingBranch && msg.parentId === activeBranchHeadId) {
             const ghostMsg: Message = {
                id: 'ghost-draft',
                parentId: activeBranchHeadId,
                author: Author.USER,
                content: '',
                timestamp: Date.now()
            };
            if (!siblings.some(s => s.id === 'ghost-draft')) {
                siblings = [...siblings, ghostMsg];
            }
        }
        
        if (msg.id === 'ghost-draft') {
             const realSiblings = messages.filter(m => m.parentId === activeBranchHeadId);
             realSiblings.sort((a, b) => a.timestamp - b.timestamp);
             siblings = [...realSiblings, msg];
        }

        if (siblings.length >= 1) {
            const index = siblings.findIndex(s => s.id === msg.id);
            const prev = siblings[index - 1];
            const next = siblings[index + 1];

            return {
                ...msg,
                siblingCount: siblings.length,
                siblingIndex: index + 1,
                prevSibling: prev?.id === 'ghost-draft' ? undefined : prev, 
                nextSibling: next?.id === 'ghost-draft' ? undefined : next
            };
        }
        return msg;
    });
  }, [messages, activeBranchHeadId, isDraftingBranch]);

  // --- 2. Intelligent Auto-Summarizer ---
  const lastAnalyzedIndexRef = useRef<number>(0);

  // RESET LOGIC: Ensure we don't re-analyze old chapters when switching branches
  // This logic "snaps" the AI cursor to the correct position in the new timeline
  useEffect(() => {
      // Find the chapters that are relevant to this specific active thread
      const threadIds = new Set(currentThread.map(m => m.id));
      const relevantChapters = chapters.filter(c => threadIds.has(c.startMessageId));

      if (relevantChapters.length > 0) {
          // Find the last chapter for this branch
          const lastChap = relevantChapters[relevantChapters.length - 1];
          // Find where this chapter starts in the current array
          const startIndex = currentThread.findIndex(m => m.id === lastChap.startMessageId);
          
          if (startIndex !== -1) {
              // Set the analysis cursor to the end of this chapter's known messages.
              // We use Math.min to ensure we don't go out of bounds if the thread is short.
              const safeIndex = Math.min(currentThread.length, startIndex + lastChap.messageCount);
              
              // Only advance the cursor if it's lagging behind the structural truth
              // OR if we switched branches and need to snap to the correct context.
              if (lastAnalyzedIndexRef.current < safeIndex || lastAnalyzedIndexRef.current > currentThread.length) {
                   lastAnalyzedIndexRef.current = safeIndex;
              }
          }
      } else {
          // If no chapters exist for this thread, we should start fresh (e.g. index 0)
          // unless we are streaming a new response, in which case we let the other effect handle incrementing.
          if (!isStreaming && currentThread.length < lastAnalyzedIndexRef.current) {
               lastAnalyzedIndexRef.current = 0;
          }
      }
  }, [activeBranchHeadId, chapters, isStreaming]); // Depend on ID switch and structure changes

  useEffect(() => {
      if (!isStreaming && currentThread.length > 0) {
          const validMessages = currentThread.filter(m => m.id !== 'ghost-draft');
          const totalCount = validMessages.length;
          
          // Safety clamp
          if (lastAnalyzedIndexRef.current > totalCount) {
             lastAnalyzedIndexRef.current = Math.max(0, totalCount - 1); 
          }

          const newMessagesCount = totalCount - lastAnalyzedIndexRef.current;
          
          // Trigger analysis if we have new content (at least 1 new message pair typically)
          const isTurnComplete = newMessagesCount >= 1; 
          const isStart = chapters.length === 0 && totalCount >= 1;

          if (isStart || isTurnComplete) {
              const bufferMessages = validMessages.slice(lastAnalyzedIndexRef.current);
              if (bufferMessages.length === 0) return;

              const contextBlock = bufferMessages.map(m => ({
                  role: m.author === Author.USER ? 'user' : 'model',
                  content: m.content
              }));

              const currentTopic = chapters.length > 0 ? chapters[chapters.length - 1].title : null;

              analyzeTopicShift(currentTopic, contextBlock, preferredBackend).then(result => {
                  setChapters(prev => {
                      // 1. Check if the start of this buffer matches an existing "Manual Branch" chapter
                      // If so, we UPDATE that chapter instead of creating a new one or extending the previous one.
                      const startMsg = bufferMessages[0];
                      if (!startMsg) return prev;

                      const manualChapterIndex = prev.findIndex(c => c.startMessageId === startMsg.id);
                      if (manualChapterIndex !== -1) {
                          const existing = prev[manualChapterIndex];
                          const updated = [...prev];
                          updated[manualChapterIndex] = {
                              ...existing,
                              title: result === "SAME" ? existing.title : result,
                              messageCount: existing.messageCount + newMessagesCount,
                              subtopics: Array.from(new Set([...existing.subtopics, ...extractSubtopics(bufferMessages)])).slice(0, 12)
                          };
                          return updated;
                      }

                      // 2. Standard "Same Topic" Extension Logic
                      if (result === "SAME" && prev.length > 0) {
                          const updatedChapters = [...prev];
                          // Important: Ensure we are updating the correct chapter for THIS thread
                          // We find the last chapter that belongs to this thread's ancestry
                          const threadIds = new Set(validMessages.map(m => m.id));
                          
                          // Polyfill findLastIndex
                          let lastRelevantChapIndex = -1;
                          for (let i = updatedChapters.length - 1; i >= 0; i--) {
                              if (threadIds.has(updatedChapters[i].startMessageId)) {
                                  lastRelevantChapIndex = i;
                                  break;
                              }
                          }
                          
                          if (lastRelevantChapIndex !== -1) {
                              const lastChap = updatedChapters[lastRelevantChapIndex];
                              const newSubtopics = extractSubtopics(bufferMessages);
                              
                              updatedChapters[lastRelevantChapIndex] = {
                                  ...lastChap,
                                  messageCount: lastChap.messageCount + newMessagesCount,
                                  subtopics: Array.from(new Set([...lastChap.subtopics, ...newSubtopics])).slice(0, 12)
                              };
                              return updatedChapters;
                          }
                      }

                      // 3. New Chapter Creation
                      const newChapterId = `chap-${Date.now()}`;
                      
                      return [...prev, {
                          id: newChapterId,
                          title: result === "SAME" ? "Greeting" : result, 
                          category: determineCategory(result),
                          startMessageId: startMsg.id,
                          messageCount: newMessagesCount || 1,
                          subtopics: extractSubtopics(bufferMessages)
                      }];
                  });
              });

              lastAnalyzedIndexRef.current = totalCount;
          }
      }
  }, [currentThread.length, isStreaming, preferredBackend]);

  const determineCategory = (title: string): MessageCategory => {
      // Logic simplified as we are deemphasizing categories visually
      const t = title.toLowerCase();
      if (t === 'same') return MessageCategory.REFINEMENT;
      if (t.includes('brainstorm') || t.includes('idea')) return MessageCategory.BRAINSTORM;
      if (t.includes('decision') || t.includes('select')) return MessageCategory.DECISION;
      if (t.includes('refine') || t.includes('fix') || t.includes('edit') || t.includes('improve')) return MessageCategory.REFINEMENT;
      if (t.includes('context') || t.includes('analyze') || t.includes('greeting') || t.includes('start')) return MessageCategory.CONTEXT;
      return MessageCategory.TANGENT;
  };

  const extractSubtopics = (msgs: Message[]) => {
      const IGNORED_WORDS = ['hey', 'hello', 'hi', 'ok', 'okay', 'thanks', 'thank you', 'yes', 'no', 'sure', 'start'];
      return msgs
        .filter(m => {
            const content = m.content.toLowerCase().trim();
            const isIgnored = IGNORED_WORDS.includes(content);
            // Relaxed filtering: Allow short messages if they aren't ignored words
            // Removed the strict length < 60 check to allow truncation instead
            return m.author === Author.USER && !isIgnored && m.content.length > 1;
        })
        .slice(0, 2)
        .map(m => {
            // Truncate long messages instead of hiding them
            if (m.content.length > 55) {
                return m.content.slice(0, 55).trim() + '...';
            }
            return m.content;
        });
  };

  useEffect(() => {
    if (viewMode !== 'LINEAR') return;

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
            const msgId = entry.target.getAttribute('data-message-id');
            if (!msgId) return;

            const matchingChapter = chapters.find(c => c.startMessageId === msgId);
            if (matchingChapter) {
                setActiveChapterId(matchingChapter.id);
            }
        }
      });
    };

    observerRef.current = new IntersectionObserver(handleIntersect, {
      root: scrollContainerRef.current,
      threshold: 0.1, 
      rootMargin: '-20% 0px -60% 0px' 
    });

    chapters.forEach(c => {
        const el = document.getElementById(`msg-bubble-${c.startMessageId}`);
        if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [chapters, currentThread, viewMode]);

  useEffect(() => {
    let pinchTimeout: ReturnType<typeof setTimeout>;

    const handleWheel = (e: WheelEvent) => {
        if (viewMode !== 'LINEAR') return;

        if (e.ctrlKey) {
            e.preventDefault();
            const currentScale = containerScale.get();
            const delta = e.deltaY * 0.01; 
            const nextScale = Math.max(0.3, Math.min(1.1, currentScale - delta));
            
            containerScale.set(nextScale);

            if (nextScale < 0.60) {
                animate(containerScale, 0.4, { duration: 0.25, ease: [0.32, 0.72, 0, 1] }).then(() => {
                     setViewMode('CANVAS');
                     setTimeout(() => containerScale.set(1), 500);
                });
            }

            clearTimeout(pinchTimeout);
            pinchTimeout = setTimeout(() => {
                const finalScale = containerScale.get();
                if (finalScale >= 0.60) {
                    animate(containerScale, 1, { 
                        type: "spring", 
                        stiffness: 400, 
                        damping: 30 
                    });
                }
            }, 150);
        }
    };

    const container = linearViewRef.current;
    if (container) {
        container.addEventListener('wheel', handleWheel, { passive: false });
    } else {
        window.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
        if (container) {
            container.removeEventListener('wheel', handleWheel);
        }
        window.removeEventListener('wheel', handleWheel);
        clearTimeout(pinchTimeout);
    };
  }, [viewMode]);

  const scrollToBottom = () => {
      if (isStreaming) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
  };
  
  useEffect(() => {
    if (viewMode === 'LINEAR' && !isNewChat) {
        scrollToBottom();
    }
  }, [currentThread.length, isStreaming]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isStreaming) return;

    const content = inputText;
    setInputText(''); 
    setIsStreaming(true);
    
    const wasDrafting = isDraftingBranch;
    setIsDraftingBranch(false); 

    const newMsgId = `msg-${Date.now()}`;
    const parentHasChildren = messages.some(m => m.parentId === activeBranchHeadId);
    if (parentHasChildren) {
        setShowCanvasTip(true); 
    }

    const newMessage: Message = {
      id: newMsgId,
      parentId: activeBranchHeadId,
      author: Author.USER,
      content: content,
      timestamp: Date.now(),
      category: MessageCategory.REFINEMENT,
      branchId: wasDrafting ? `b-${Date.now()}` : undefined
    };

    // --- IMMEDIATE BRANCH CHAPTER CREATION ---
    // Detect if we are branching off an existing tree (either explicit draft or implicit fork)
    const isBranching = wasDrafting || (messages.some(m => m.parentId === activeBranchHeadId) && activeBranchHeadId !== 'root');
    
    if (isBranching) {
        const newBranchChapter: Chapter = {
            id: `chap-${Date.now()}`,
            title: `Branch: ${content.slice(0, 15)}${content.length > 15 ? '...' : ''}`,
            category: MessageCategory.DECISION,
            startMessageId: newMsgId, // The message we just created
            messageCount: 0, // Starts at 0, will be incremented by response pairing in useEffect logic
            subtopics: []
        };
        // We add it immediately so sidebar updates
        setChapters(prev => [...prev, newBranchChapter]);
    }

    setMessages(prev => [...prev, newMessage]);
    setActiveBranchHeadId(newMsgId);

    const history = [...currentThread.filter(m => m.id !== 'ghost-draft'), newMessage].map(m => ({
        role: m.author === Author.USER ? 'user' : 'model',
        content: m.content
    }));
    
    const responseId = `resp-${Date.now()}`;
    const responsePlaceholder: Message = {
        id: responseId,
        parentId: newMsgId,
        author: Author.ASSISTANT,
        content: '',
        timestamp: Date.now() + 1
    };

    setMessages(prev => [...prev, responsePlaceholder]);
    setActiveBranchHeadId(responseId);

    let fullResponse = '';
    await streamResponse(
        history, 
        (chunk) => {
            fullResponse += chunk;
            setMessages(prev => prev.map(m => 
                m.id === responseId ? { ...m, content: fullResponse } : m
            ));
        },
        (type) => setBackendType(type),
        preferredBackend,
        selectedModelId 
    );
    
    setIsStreaming(false);
  };

  const handleBranch = (fromMessageId: string) => {
    setActiveBranchHeadId(fromMessageId);
    setIsDraftingBranch(true);
    setViewMode('LINEAR');
    setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const handleSwipeBranch = (currentMsgId: string, direction: 'prev' | 'next') => {
      setSwipeDirection(direction === 'prev' ? 'left' : 'right');

      const currentMsg = messages.find(m => m.id === currentMsgId);
      const effectiveParentId = currentMsg ? currentMsg.parentId : (currentMsgId === 'ghost-draft' ? activeBranchHeadId : null);
      
      if (!effectiveParentId) return;

      const siblings = messages.filter(m => m.parentId === effectiveParentId);
      siblings.sort((a, b) => a.timestamp - b.timestamp);
      
      let currentIndex = currentMsgId === 'ghost-draft' 
            ? siblings.length 
            : siblings.findIndex(s => s.id === currentMsgId);

      if (currentIndex === -1) return;

      let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (currentMsgId === 'ghost-draft' && direction === 'prev') {
          nextIndex = siblings.length - 1;
      }
      if (nextIndex >= siblings.length) nextIndex = 0;
      if (nextIndex < 0) nextIndex = siblings.length - 1;

      const targetSibling = siblings[nextIndex];
      if (currentMsgId === 'ghost-draft') setIsDraftingBranch(false);

      let pointer = targetSibling.id;
      let hasChild = true;
      while (hasChild) {
          const children = messages.filter(m => m.parentId === pointer);
          if (children.length > 0) {
              children.sort((a, b) => b.timestamp - a.timestamp);
              pointer = children[0].id; 
          } else {
              hasChild = false;
          }
      }
      setActiveBranchHeadId(pointer);
  };

  const findBestBranchHead = useCallback((targetMsgId: string): string => {
        if (targetMsgId === ROOT_MESSAGE.id) {
             const children = messages.filter(m => m.parentId === ROOT_MESSAGE.id);
             if (children.length > 0) return findBestBranchHead(children[0].id);
             return ROOT_MESSAGE.id;
        }

        const parentIds = new Set(messages.map(m => m.parentId).filter(Boolean) as string[]);
        const leaves = messages.filter(m => !parentIds.has(m.id));

        const descendantLeaves = leaves.filter(leaf => {
            let curr: string | null = leaf.id;
            let safety = 0;
            while (curr && safety < 1000) {
                safety++;
                if (curr === targetMsgId) return true;
                const msg = messages.find(m => m.id === curr);
                curr = msg ? msg.parentId : null;
            }
            return false;
        });

        if (descendantLeaves.length > 0) {
            descendantLeaves.sort((a, b) => b.timestamp - a.timestamp);
            return descendantLeaves[0].id;
        }

        return targetMsgId;
  }, [messages]);

  const handleNavigate = (msgId: string) => {
      // Clear drafting state to prevent ghost loops
      setIsDraftingBranch(false);

      const newHead = findBestBranchHead(msgId);
      setActiveBranchHeadId(newHead);
      
      if (!currentThread.some(m => m.id === msgId)) {
          lastAnalyzedIndexRef.current = 0;
      }

      if (viewMode === 'CANVAS') {
          setViewMode('LINEAR');
          containerScale.set(0.6);
          animate(containerScale, 1, { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] });
          
          setTimeout(() => {
             const el = document.getElementById(`msg-bubble-${msgId}`);
             el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
      } else {
          const el = document.getElementById(`msg-bubble-${msgId}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  };

  const handleUpdateNodeTitle = (startMessageId: string, newTitle: string) => {
      setChapters(prev => {
          const existing = prev.find(c => c.startMessageId === startMessageId);
          if (existing) {
              return prev.map(c => c.id === existing.id ? { ...c, title: newTitle } : c);
          }
          
          // If no existing chapter, create a manual marker
          const newChap: Chapter = {
              id: `chap-manual-${Date.now()}`,
              title: newTitle,
              category: MessageCategory.REFINEMENT, // Default for manual
              startMessageId: startMessageId,
              messageCount: 1, // Placeholder
              subtopics: []
          };
          
          const updated = [...prev, newChap];
          // Sort by message timestamp to keep timeline consistent
          updated.sort((a, b) => {
             const msgA = messages.find(m => m.id === a.startMessageId);
             const msgB = messages.find(m => m.id === b.startMessageId);
             return (msgA?.timestamp || 0) - (msgB?.timestamp || 0);
          });
          return updated;
      });
  };
  
  const handleResetChat = () => {
     setMessages(INITIAL_MESSAGES);
     setChapters([]);
     lastAnalyzedIndexRef.current = 0;
     setActiveBranchHeadId(ROOT_MESSAGE.id);
     setShowCanvasTip(false);
     setIsDraftingBranch(false);
  }

  const renderInputArea = (centered: boolean) => (
      <div className={`
          relative bg-white rounded-2xl border transition-all duration-300 pointer-events-auto
          ${centered ? 'shadow-lg hover:shadow-xl focus-within:shadow-xl border-gray-200' : 'shadow-input focus-within:shadow-md focus-within:border-gray-300 border-gray-200'}
          ${isDraftingBranch ? 'ring-2 ring-claude-accent/30 border-claude-accent/50' : ''}
      `}>
          <div className="p-3">
            <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                    if(e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                    }
                }}
                placeholder={isDraftingBranch ? "Type a new direction to branch from here..." : "How can I help you today?"}
                className="w-full resize-none outline-none text-gray-700 placeholder-gray-400 font-serif bg-transparent px-2 py-1"
                rows={1}
                style={{ minHeight: centered ? '52px' : '44px', maxHeight: '200px' }}
            />
            
            <div className="flex items-center justify-between mt-2 px-1">
                <div className="flex items-center gap-4">
                     <button 
                        onClick={() => setIsExtendedThinking(!isExtendedThinking)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${isExtendedThinking ? 'bg-claude-accent/10 text-claude-accent' : 'hover:bg-gray-100 text-gray-500'}`}
                     >
                        <Clock size={14} className={isExtendedThinking ? 'fill-current' : ''} />
                        <span>Extended thinking</span>
                        <span className="text-gray-300 ml-1">▼</span>
                     </button>
                     <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400"><Paperclip size={18} /></button>
                </div>
                <button 
                    disabled={!inputText.trim() || isStreaming}
                    onClick={handleSendMessage}
                    className={`rounded-lg p-2 transition-all duration-200 ${inputText.trim() ? 'bg-claude-accent text-white shadow-sm hover:bg-[#16A39B]' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
                >
                    {centered ? <ArrowUp size={18} /> : <Send size={16} />}
                </button>
            </div>
          </div>
      </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans text-claude-text bg-claude-bg">
      <OllamaGuide isOpen={showOllamaHelp} onClose={() => setShowOllamaHelp(false)} />
      
      {/* Hide Sidebar in Canvas Mode */}
      {viewMode === 'LINEAR' && (
        <Sidebar 
          chapters={chapters} 
          currentThreadMessages={currentThread}
          allMessages={messages} // Pass full history for branch detection
          onNavigate={handleNavigate}
          activeMessageId={activeBranchHeadId}
          activeChapterId={activeChapterId}
          backendType={backendType}
          onToggleBackend={() => setPreferredBackend(prev => prev === 'GEMINI' ? 'OLLAMA' : 'GEMINI')}
          preferredBackend={preferredBackend}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          onShowOllamaHelp={() => setShowOllamaHelp(true)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative bg-gray-100/50">
        {!isNewChat && (
            <header className="h-14 flex items-center justify-between px-6 flex-shrink-0 z-20 bg-claude-bg/95 backdrop-blur-sm sticky top-0 border-b border-gray-100">
                <div className="flex items-center gap-2 cursor-pointer hover:bg-black/5 py-1 px-2 rounded-lg transition-colors group">
                    <h1 className="font-serif text-gray-700 font-medium truncate max-w-[200px]">
                        {chapters.length > 0 ? chapters[chapters.length-1].title : 'Conversation'}
                    </h1>
                    <span className="text-gray-400 text-xs mt-0.5 group-hover:text-gray-600">▼</span>
                </div>

                <div className="flex items-center gap-3 relative">
                    <div className="flex bg-claude-sidebar p-0.5 rounded-lg relative border border-gray-200">
                        <button 
                            onClick={() => setViewMode('LINEAR')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'LINEAR' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Chat
                        </button>
                        <button 
                            onClick={() => setViewMode('CANVAS')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'CANVAS' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Canvas
                        </button>
                    </div>
                    
                    <button onClick={handleResetChat} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-black/5" title="Start New Chat">
                        <Plus size={16} />
                    </button>
                    <Button variant="secondary" className="text-xs h-8">
                        <Share size={14} /> Share
                    </Button>
                </div>
            </header>
        )}

        <AnimatePresence mode="wait">
        {viewMode === 'LINEAR' ? (
            <motion.div 
                key="linear-view"
                ref={linearViewRef}
                className="flex-1 flex flex-col overflow-hidden origin-center bg-white shadow-xl relative"
                style={{ 
                    scale: containerScale,
                    opacity: containerOpacity,
                    borderRadius: containerRadius,
                    y: containerY
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
            {isNewChat ? (
                 <div className="flex-1 flex flex-col items-center justify-center p-6 pb-32 animate-in fade-in duration-500">
                     <div className="text-center mb-10">
                         <div className="inline-flex items-center justify-center p-3 mb-6 bg-white rounded-2xl shadow-sm border border-gray-100/50">
                            <div className="text-claude-accent animate-pulse">
                                <Sparkles size={28} />
                            </div>
                         </div>
                         <h1 className="font-serif text-4xl text-claude-text font-medium tracking-tight mb-2">
                            ThreadCanvas
                         </h1>
                     </div>
                     
                     <div className="w-full max-w-2xl">
                         {renderInputArea(true)}
                         <div className="text-center mt-4">
                            <p className="text-[11px] text-gray-400 font-medium">ThreadCanvas AI • Branching • Canvas • Context</p>
                         </div>
                     </div>
                </div>
            ) : (
                <div 
                    className="flex-1 overflow-y-auto overflow-x-visible px-[5%] md:px-[15%] pt-4 custom-scrollbar scroll-smooth"
                    ref={scrollContainerRef}
                >
                    <div className="max-w-3xl mx-auto pb-[240px]"> 
                        {currentThread.map((msg, idx) => {
                             const msgWithSiblings = msg as any;
                             return (
                                <div key={msg.id} id={`msg-bubble-${msg.id}`} data-message-id={msg.id}>
                                    <MessageBubble 
                                        message={msgWithSiblings} 
                                        onBranch={handleBranch}
                                        onSwipeBranch={handleSwipeBranch}
                                        isHead={idx === currentThread.length - 1}
                                        parentContent={messages.find(m => m.id === msg.parentId)?.content}
                                        slideDirection={swipeDirection}
                                        prevSibling={msgWithSiblings.prevSibling}
                                        nextSibling={msgWithSiblings.nextSibling}
                                    />
                                </div>
                             );
                        })}
                        
                        {isStreaming && (
                            <div className="flex items-center gap-3 ml-1 mb-8 animate-in fade-in slide-in-from-bottom-2">
                                <div className="w-8 h-8 rounded-full bg-claude-accent text-white flex items-center justify-center shadow-sm animate-pulse">
                                    <span className="font-serif font-bold text-xs">AI</span>
                                </div>
                                <span className="text-gray-400 text-sm font-serif italic">Thinking...</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} className="h-1" />
                    </div>
                </div>
            )}
            {!isNewChat && (
                <div className="absolute bottom-0 left-0 right-0 pb-8 pt-6 px-6 bg-gradient-to-t from-white via-white via-80% to-transparent z-10 pointer-events-none">
                    <div className="max-w-3xl mx-auto">
                        {renderInputArea(false)}
                        <div className="text-center mt-3">
                            <p className="text-[10px] text-gray-400">AI can make mistakes. Branch to explore alternatives.</p>
                        </div>
                    </div>
                </div>
            )}
            </motion.div>
        ) : (
            <CanvasView 
                key="canvas-view"
                messages={messages} 
                chapters={chapters}
                activeBranchHeadId={activeBranchHeadId}
                onNavigate={handleNavigate}
                entryAnimation={true}
                onUpdateNodeTitle={handleUpdateNodeTitle}
            />
        )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
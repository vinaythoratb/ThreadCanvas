
import React, { useMemo, useState, useRef, useEffect, memo, Dispatch, SetStateAction } from 'react';
import { Message, MessageCategory, Author, Chapter } from '../types';
import { Clock, Layers, ZoomIn, ZoomOut, Maximize, GitCommit, FileText, ChevronRight, Edit2 } from 'lucide-react';
import { motion, useMotionValue, animate, MotionValue, useTransform, PanInfo } from 'framer-motion';

interface CanvasViewProps {
    messages: Message[];
    chapters: Chapter[];
    activeBranchHeadId: string;
    onNavigate: (msgId: string) => void;
    entryAnimation?: boolean;
    onUpdateNodeTitle?: (startMessageId: string, newTitle: string) => void;
}

// Types

interface NodePosition {
    x: number;
    y: number;
}

interface GroupedNode {
    // The ID of the LAST message in the group  
    id: string;
    startMessageId: string;
    messages: Message[];
    // IDs of the first messages of child groups
    childrenIds: string[];
    x: number;
    y: number;
    depth: number;
    title: string;
    preview: string;
    hasCode: boolean;
    hasList: boolean;
    language?: string;
    timestamp: number;
    // New: Chapters contained within this node
    internalChapters: Chapter[];
    isRoot: boolean;
}

// Constants 
const GROUP_WIDTH = 280;
const GROUP_HEIGHT = 160;
const X_SPACING = 340;
const Y_SPACING = 190;
const CANVAS_SIZE = 50000;
const CANVAS_CENTER = CANVAS_SIZE / 2;

// Helper Functions 

const getNodeStyles = (isRoot: boolean, isActive: boolean) => {
    if (isRoot) {
        // Blue for the start node
        return {
            border: '#60A5FA', // Blue-400
            header: '#EFF6FF', // Blue-50
            ring: 'rgba(96, 165, 250, 0.3)'
        };
    }
    if (isActive) {
        // Green/Teal for the active context node
        return {
            border: '#34D399', // Emerald-400
            header: '#ECFDF5', // Emerald-50
            ring: 'rgba(52, 211, 153, 0.3)'
        };
    }
    // Faded inactive grey for the rest
    return {
        border: '#E5E7EB', // Gray-200
        header: '#F9FAFB', // Gray-50
        ring: 'transparent'
    };
};

const getRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

const cleanTextPreview = (text: string) => {
    return text
        .replace(/^Sure, I can help.*/i, '')
        .replace(/^Here is the.*/i, '')
        .replace(/^Certainly!.*/i, '')
        .replace(/^I'd be happy to.*/i, '')
        .replace(/\*\*/g, '')
        .replace(/^SYSTEM_ROOT$/i, '')
        .trim();
};

const extractCodeSnippet = (text: string): { lang: string, snippet: string } | null => {
    const match = text.match(/```(\w+)?\n([\s\S]*?)```/);
    if (match) {
        const lang = match[1] || 'Code';
        const lines = match[2].split('\n').filter(l => l.trim().length > 0).slice(0, 3);
        return { lang, snippet: lines.join('\n') };
    }
    return null;
};

const extractListPreview = (text: string): string | null => {
    const listItems = text.match(/^[-*•] .+$|^\d+\. .+$/gm);
    if (listItems && listItems.length > 0) {
        return listItems.slice(0, 2).join('\n');
    }
    return null;
}

// Robust Graph Algorithms (Structure Only)

const groupMessages = (allMessages: Message[], chapters: Chapter[]): GroupedNode[] => {
    if (allMessages.length === 0) return [];

    const childrenMap = new Map<string, string[]>();
    const messageMap = new Map<string, Message>();

    let rootId: string | null = null;

    allMessages.forEach(m => {
        messageMap.set(m.id, m);
        if (m.parentId) {
            if (!childrenMap.has(m.parentId)) childrenMap.set(m.parentId, []);
            childrenMap.get(m.parentId)?.push(m.id);
        } else {
            rootId = m.id;
        }
    });

    if (!rootId) return [];

    const groups: GroupedNode[] = [];
    const visitedMsgIds = new Set<string>();

    const buildGroup = (startMsgId: string, depth: number): string | null => {
        if (visitedMsgIds.has(startMsgId)) return null;

        const currentGroupMessages: Message[] = [];
        let currId: string | null = startMsgId;

        while (currId) {
            if (visitedMsgIds.has(currId)) break;

            const msg = messageMap.get(currId);
            if (!msg) break;

            visitedMsgIds.add(currId);
            currentGroupMessages.push(msg);

            const children = childrenMap.get(currId) || [];

            // Branching point: If more than 1 child, we break the group here.
            if (children.length === 1) {
                currId = children[0];
            } else {
                currId = null;
            }
        }

        if (currentGroupMessages.length === 0) return null;

        const tailMsg = currentGroupMessages[currentGroupMessages.length - 1];
        const isRootNode = currentGroupMessages[0].id === rootId;

        // Metadata Extraction
        const firstUserMsg = currentGroupMessages.find(m => m.author === Author.USER);
        const lastAiMsg = [...currentGroupMessages].reverse().find(m => m.author === Author.ASSISTANT);

        // Find which chapters are contained within this group
        const groupMessageIds = new Set(currentGroupMessages.map(m => m.id));
        const internalChapters = chapters.filter(c => groupMessageIds.has(c.startMessageId));

        const mainChapter = internalChapters.length > 0 ? internalChapters[internalChapters.length - 1] : null;

        let title = "";

        if (isRootNode) {
            title = "Start";
        } else if (mainChapter) {
            title = mainChapter.title;
        } else {
            // "Name it accordingly by analyzing content" -> Using heuristic fallback if no AI chapter title
            if (firstUserMsg) {
                const raw = firstUserMsg.content;
                title = raw.slice(0, 35) + (raw.length > 35 ? '...' : '');
            } else {
                title = "System";
            }
        }

        const aiContent = lastAiMsg ? lastAiMsg.content : "System";
        const hasCode = aiContent.includes('```');
        const hasList = /^(- |\d+\. )/m.test(aiContent);

        let preview = "";
        let language = undefined;

        if (isRootNode) {
            preview = "Conversation Start";
        } else if (hasCode) {
            const codeData = extractCodeSnippet(aiContent);
            if (codeData) {
                preview = codeData.snippet;
                language = codeData.lang;
            } else {
                preview = cleanTextPreview(aiContent).slice(0, 70);
            }
        } else if (hasList) {
            const listData = extractListPreview(aiContent);
            if (listData) preview = listData;
            else preview = cleanTextPreview(aiContent).slice(0, 70);
        } else {
            preview = cleanTextPreview(aiContent).slice(0, 80) + (aiContent.length > 80 ? '...' : '');
        }

        const node: GroupedNode = {
            id: tailMsg.id,
            startMessageId: startMsgId,
            messages: currentGroupMessages,
            childrenIds: [],
            x: depth * X_SPACING + 50,
            y: 0,
            depth: depth,
            title,
            preview,
            hasCode,
            hasList,
            language,
            timestamp: tailMsg.timestamp,
            internalChapters: internalChapters,
            isRoot: isRootNode
        };

        groups.push(node);

        const tailChildren = childrenMap.get(tailMsg.id) || [];
        tailChildren.forEach(childId => {
            const childGroupId = buildGroup(childId, depth + 1);
            if (childGroupId) {
                node.childrenIds.push(childGroupId);
            }
        });

        return node.id;
    };

    buildGroup(rootId, 0);
    return groups;
};

// 2. Layout Calculation
const calculateGroupLayout = (groups: GroupedNode[]) => {
    if (groups.length === 0) return [];

    const groupMap = new Map<string, GroupedNode>();
    groups.forEach(g => groupMap.set(g.id, g));

    const getGroupChildren = (g: GroupedNode) =>
        g.childrenIds.map(id => groupMap.get(id)).filter(Boolean) as GroupedNode[];

    const processedNodes = new Set<string>();

    const assignY = (node: GroupedNode, startY: number): number => {
        if (processedNodes.has(node.id)) return 1;
        processedNodes.add(node.id);

        const children = getGroupChildren(node);

        if (children.length === 0) {
            node.y = startY;
            return 1;
        }

        let currentY = startY;
        let totalHeight = 0;

        children.forEach(child => {
            const childHeight = assignY(child, currentY);
            currentY += childHeight * Y_SPACING;
            totalHeight += childHeight;
        });

        const firstChildY = children[0].y;
        const lastChildY = children[children.length - 1].y;
        node.y = (firstChildY + lastChildY) / 2;

        return totalHeight;
    };

    const roots = groups.filter(g => g.depth === 0);
    let currentRootY = 100;

    roots.forEach(root => {
        const height = assignY(root, currentRootY);
        currentRootY += height * Y_SPACING;
    });

    return groups;
};

// Minimap Component

interface MinimapProps {
    nodes: GroupedNode[];
    activeId: string;
    x: MotionValue<number>;
    y: MotionValue<number>;
    scale: MotionValue<number>;
}

const Minimap = memo(({ nodes, activeId, x, y, scale }: MinimapProps) => {
    const MAP_WIDTH = 180;
    const MAP_HEIGHT = 120;
    const PADDING = 40;

    const bounds = useMemo(() => {
        if (nodes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 1, h: 1 };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        });
        const w = (maxX + GROUP_WIDTH) - minX;
        const h = (maxY + GROUP_HEIGHT) - minY;
        return { minX, minY, w, h };
    }, [nodes]);

    const fitScale = useMemo(() => {
        if (bounds.w <= 0 || bounds.h <= 0) return 0.1;
        const scaleX = (MAP_WIDTH - PADDING) / bounds.w;
        const scaleY = (MAP_HEIGHT - PADDING) / bounds.h;
        return Math.min(scaleX, scaleY, 0.12);
    }, [bounds]);

    const miniScale = useTransform(scale, s => s * fitScale);
    const miniX = useTransform([x, scale], (values: any[]) => {
        const [latestX, latestScale] = values;
        return (latestX / latestScale) * fitScale + (MAP_WIDTH / 2);
    });
    const miniY = useTransform([y, scale], (values: any[]) => {
        const [latestY, latestScale] = values;
        return (latestY / latestScale) * fitScale + (MAP_HEIGHT / 2);
    });

    return (
        <div
            className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg relative select-none overflow-hidden"
            style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
        >
            <motion.div
                style={{
                    x: miniX,
                    y: miniY,
                    scale: miniScale,
                    originX: 0.5,
                    originY: 0.5
                }}
                className="absolute top-0 left-0 w-full h-full"
            >
                {nodes.map(node => {
                    const isActive = node.id === activeId || node.messages.some(m => m.id === activeId);
                    // Minimap colors matching new scheme
                    const bgClass = node.isRoot ? 'bg-blue-400' : (isActive ? 'bg-emerald-400' : 'bg-gray-300');
                    return (
                        <div
                            key={node.id}
                            className={`absolute rounded-[2px] ${bgClass}`}
                            style={{
                                left: node.x - bounds.minX - bounds.w / 2,
                                top: node.y - bounds.minY - bounds.h / 2,
                                width: GROUP_WIDTH,
                                height: GROUP_HEIGHT
                            }}
                        />
                    );
                })}
            </motion.div>
        </div>
    );
});

// Canvas Node Component

interface CanvasNodeProps {
    node: GroupedNode;
    isActive: boolean;
    isHead: boolean;
    setNodeOverrides: Dispatch<SetStateAction<Record<string, NodePosition>>>;
    onNavigate: (id: string) => void;
    setDraggingNodeId: (id: string | null) => void;
    isDragging: boolean;
    onUpdateNodeTitle?: (startMessageId: string, newTitle: string) => void;
}

const CanvasNode = memo(({ node, isActive, isHead, setNodeOverrides, onNavigate, setDraggingNodeId, isDragging, onUpdateNodeTitle }: CanvasNodeProps) => {
    const [showTimeline, setShowTimeline] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(node.title);

    const styles = getNodeStyles(node.isRoot, isActive);

    // Opacity logic for "Faded inactive grey"
    const opacityClass = isActive || node.isRoot ? 'opacity-100' : 'opacity-60 hover:opacity-100';

    // Reset view when node changes significantly
    useEffect(() => {
        setShowTimeline(false);
        setEditTitle(node.title);
    }, [node.id, node.title]);

    const hasInternalChapters = node.internalChapters.length > 1;

    const handleSaveTitle = () => {
        setIsEditing(false);
        if (editTitle.trim() && editTitle !== node.title && onUpdateNodeTitle) {
            onUpdateNodeTitle(node.startMessageId, editTitle);
        } else {
            setEditTitle(node.title);
        }
    };

    return (
        <motion.div
            className={`absolute w-[280px] h-[160px] cursor-grab active:cursor-grabbing pointer-events-auto transition-opacity duration-300 ${opacityClass}`}
            style={{
                x: CANVAS_CENTER + node.x,
                y: CANVAS_CENTER + node.y,
                zIndex: isDragging ? 50 : (isActive ? 20 : 10)
            }}
            drag
            dragElastic={0}
            dragMomentum={false}
            onTap={(e, info) => {
                // Only navigate if clicking the card body, not buttons or inputs
                const target = e.target as HTMLElement;
                if (!target.closest('button') && !target.closest('.timeline-item') && !target.closest('input')) {
                    let targetId = node.startMessageId;
                    if (node.messages[0].content === 'SYSTEM_ROOT' && node.messages.length > 1) {
                        targetId = node.messages[1].id;
                    }
                    onNavigate(targetId);
                }
            }}
            onDragStart={() => setDraggingNodeId(node.id)}
            onDragEnd={() => setDraggingNodeId(null)}
            onDrag={(e, info: PanInfo) => {
                setNodeOverrides(prev => ({
                    ...prev,
                    [node.id]: {
                        x: node.x + info.delta.x,
                        y: node.y + info.delta.y
                    }
                }));
            }}
            whileDrag={{ scale: 1.05, boxShadow: "0px 10px 20px rgba(0,0,0,0.15)" }}
        >
            <div
                className={`
                    w-full h-full bg-white rounded-xl shadow-sm border flex flex-col transition-all duration-200
                    ${isActive ? 'shadow-md' : 'shadow-sm hover:shadow-lg'}
                `}
                style={{
                    borderColor: styles.border,
                    boxShadow: isActive ? `0 4px 6px -1px ${styles.ring}, 0 2px 4px -1px ${styles.ring}` : undefined
                }}
            >
                {/* Header */}
                <div
                    className="h-10 px-3 flex items-center justify-between border-b rounded-t-xl gap-2"
                    style={{ backgroundColor: styles.header, borderColor: styles.border }}
                >
                    {isEditing ? (
                        <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                            className="bg-white border border-blue-300 rounded px-1.5 py-0.5 text-xs font-bold text-gray-800 w-full outline-none shadow-sm min-w-0"
                            autoFocus
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <div className="flex items-center gap-2 min-w-0 flex-1 group/title">
                            <span className="text-xs font-bold text-gray-700 truncate" title={node.title}>
                                {node.title}
                            </span>
                            {onUpdateNodeTitle && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                    className="opacity-0 group-hover/title:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity p-1 rounded hover:bg-black/5"
                                    title="Edit Topic Name"
                                >
                                    <Edit2 size={10} />
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowTimeline(!showTimeline); }}
                            className={`p-1 rounded hover:bg-black/5 transition-colors ${showTimeline ? 'text-gray-800 bg-white shadow-sm' : 'text-gray-400'}`}
                            title={showTimeline ? "Show Text Preview" : "Show Timeline"}
                        >
                            {showTimeline ? <FileText size={12} /> : <GitCommit size={12} />}
                        </button>
                    </div>
                </div>

                {/* Body - Swappable Content */}
                <div className="flex-1 p-3 flex flex-col overflow-hidden relative">
                    {showTimeline || hasInternalChapters ? (
                        // Timeline View - Always show if manually toggled OR if showing default info for multi-chapter node
                        <div className="h-full overflow-y-auto custom-scrollbar pr-1">
                            <div className="space-y-0 relative">
                                {/* Timeline Spine */}
                                <div className="absolute left-[5px] top-2 bottom-2 w-[1px] bg-gray-200"></div>

                                {node.internalChapters.map((chap, idx) => (
                                    <div
                                        key={chap.id}
                                        onClick={(e) => { e.stopPropagation(); onNavigate(chap.startMessageId); }}
                                        className="timeline-item relative pl-4 py-1.5 group/item cursor-pointer flex items-center"
                                    >
                                        <div className={`absolute left-[3px] top-[10px] w-[5px] h-[5px] rounded-full bg-gray-300 group-hover/item:bg-emerald-400 transition-colors`}></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-medium text-gray-600 group-hover/item:text-emerald-600 truncate">{chap.title}</p>
                                            <p className="text-[9px] text-gray-400 leading-none mt-0.5 truncate">{chap.subtopics[0] || 'Topic detail...'}</p>
                                        </div>
                                        <ChevronRight size={10} className="text-gray-300 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                                    </div>
                                ))}

                                {/* If just one chapter but text view isn't selected, show content preview */}
                                {node.internalChapters.length === 0 && (
                                    <p className="pl-4 text-[11px] text-gray-400 italic">No specific chapters markers.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Standard Preview View (Concise Summary)
                        <>
                            {node.hasCode ? (
                                <div className="font-mono text-[10px] text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 h-full overflow-hidden">
                                    <pre>{node.preview}</pre>
                                </div>
                            ) : (
                                <div className="text-[12px] leading-relaxed text-gray-600 font-serif line-clamp-4 select-text">
                                    {node.preview}
                                </div>
                            )}
                            {!node.hasCode && (
                                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="h-8 px-4 flex items-center justify-between border-t border-gray-50 text-[10px] text-gray-400 bg-white rounded-b-xl">
                    <div className="flex items-center gap-1.5" title={new Date(node.timestamp).toLocaleString()}>
                        <Clock size={11} />
                        <span>{getRelativeTime(node.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Layers size={11} />
                        <span>{node.messages.length} msgs</span>
                    </div>
                </div>

                {isHead && (
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full shadow-sm ring-2 ring-white z-20 animate-pulse bg-emerald-400"></div>
                )}
            </div>
        </motion.div>
    );
}, (prev: Readonly<CanvasNodeProps>, next: Readonly<CanvasNodeProps>) => {
    return (
        prev.node.x === next.node.x &&
        prev.node.y === next.node.y &&
        prev.isActive === next.isActive &&
        prev.isHead === next.isHead &&
        prev.isDragging === next.isDragging &&
        prev.node.id === next.node.id &&
        prev.node.title === next.node.title &&
        prev.node.internalChapters.length === next.node.internalChapters.length
    );
});


// Main Component

export const CanvasView: React.FC<CanvasViewProps> = ({ messages, chapters, activeBranchHeadId, onNavigate, entryAnimation = false, onUpdateNodeTitle }) => {

    const [nodeOverrides, setNodeOverrides] = useState<Record<string, NodePosition>>({});
    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

    const defaultLayoutNodes = useMemo(() => {
        const groups = groupMessages(messages, chapters);
        return calculateGroupLayout(groups);
    }, [messages, chapters]);

    const nodes = useMemo<GroupedNode[]>(() => {
        return defaultLayoutNodes.map(node => {
            const override = nodeOverrides[node.id];
            return override ? { ...node, x: override.x, y: override.y } : node;
        });
    }, [defaultLayoutNodes, nodeOverrides]);

    const edges = useMemo(() => {
        const edgeList: Array<{ sourceX: number, sourceY: number, targetX: number, targetY: number }> = [];
        const nodeMap = new Map<string, GroupedNode>(nodes.map(n => [n.id, n]));

        nodes.forEach(node => {
            node.childrenIds.forEach(childId => {
                const child = nodeMap.get(childId);
                if (child) {
                    edgeList.push({
                        sourceX: node.x + GROUP_WIDTH,
                        sourceY: node.y + GROUP_HEIGHT / 2,
                        targetX: child.x,
                        targetY: child.y + GROUP_HEIGHT / 2
                    });
                }
            });
        });
        return edgeList;
    }, [nodes]);

    const viewportRef = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const scale = useMotionValue(entryAnimation ? 2.5 : 1);

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const currentScale = scale.get();
            const d = e.deltaY * -0.01;
            const newScale = Math.min(Math.max(0.25, currentScale + d), 4);
            scale.set(newScale);
        }
        else {
            e.preventDefault();
            x.set(x.get() - e.deltaX);
            y.set(y.get() - e.deltaY);
        }
    };

    const hasCentered = useRef(false);

    useEffect(() => {
        if (nodes.length === 0) return;
        if (hasCentered.current) return;

        let activeNode = nodes.find(n => n.id === activeBranchHeadId) || nodes.find(n => n.messages.some(m => m.id === activeBranchHeadId));
        if (!activeNode) activeNode = nodes[0];

        const nodeCenterX = activeNode.x + GROUP_WIDTH / 2;
        const nodeCenterY = activeNode.y + GROUP_HEIGHT / 2;

        const targetX = -nodeCenterX;
        const targetY = -nodeCenterY;

        if (entryAnimation) {
            const startScale = 2.5;
            x.set(targetX);
            y.set(targetY);
            scale.set(startScale);
            animate(scale, 1, { type: "spring", stiffness: 200, damping: 30, mass: 1 });
        } else {
            x.set(targetX);
            y.set(targetY);
            scale.set(1);
        }
        hasCentered.current = true;
    }, [entryAnimation, nodes, activeBranchHeadId, x, y, scale]);

    const handleZoomIn = () => animate(scale, Math.min(scale.get() * 1.5, 4));
    const handleZoomOut = () => animate(scale, Math.max(scale.get() / 1.5, 0.25));
    const handleFitView = () => animate(scale, 1);

    const activeGroupIds = useMemo(() => {
        const ids = new Set<string>();
        let currentMsg = messages.find(m => m.id === activeBranchHeadId);
        const ancestorIds = new Set<string>();
        while (currentMsg) {
            ancestorIds.add(currentMsg.id);
            currentMsg = messages.find(m => m.id === currentMsg.parentId);
        }
        nodes.forEach(node => {
            if (ancestorIds.has(node.id)) ids.add(node.id);
        });
        return ids;
    }, [messages, activeBranchHeadId, nodes]);

    const activeNodeId = nodes.find(n => n.messages.some(m => m.id === activeBranchHeadId))?.id || activeBranchHeadId;

    return (
        <div ref={viewportRef} className="flex-1 overflow-hidden bg-claude-bg relative select-none h-full w-full">

            <motion.div
                className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
                style={{
                    x, y, scale,
                    backgroundImage: 'radial-gradient(#000 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                    originX: 0.5, originY: 0.5
                }}
            />

            <motion.div
                className="absolute top-1/2 left-1/2 cursor-grab active:cursor-grabbing z-10"
                style={{
                    x, y, scale,
                    width: CANVAS_SIZE,
                    height: CANVAS_SIZE,
                    marginLeft: -CANVAS_CENTER,
                    marginTop: -CANVAS_CENTER,
                    originX: 0.5, originY: 0.5
                }}
                drag
                dragMomentum={true}
                dragElastic={0.05}
                onWheel={handleWheel}
                onDragStart={() => document.body.style.cursor = 'grabbing'}
                onDragEnd={() => document.body.style.cursor = 'default'}
            >
                <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-0">
                    {edges.map((edge, idx) => (
                        <path
                            key={`edge-${idx}`}
                            d={`M ${CANVAS_CENTER + edge.sourceX} ${CANVAS_CENTER + edge.sourceY} C ${CANVAS_CENTER + edge.sourceX + 40} ${CANVAS_CENTER + edge.sourceY}, ${CANVAS_CENTER + edge.targetX - 40} ${CANVAS_CENTER + edge.targetY}, ${CANVAS_CENTER + edge.targetX} ${CANVAS_CENTER + edge.targetY}`}
                            fill="none"
                            stroke={"#D1D5DB"}
                            strokeWidth={2}
                            strokeDasharray={"0"}
                        />
                    ))}
                </svg>

                <div className="absolute inset-0 z-10 pointer-events-none">
                    {nodes.map((node) => {
                        const isActive = activeGroupIds.has(node.id);
                        const isHead = node.id === activeBranchHeadId || node.messages.some(m => m.id === activeBranchHeadId);

                        return (
                            <CanvasNode
                                key={node.id}
                                node={node}
                                isActive={isActive}
                                isHead={isHead}
                                setNodeOverrides={setNodeOverrides}
                                onNavigate={onNavigate}
                                setDraggingNodeId={setDraggingNodeId}
                                isDragging={draggingNodeId === node.id}
                                onUpdateNodeTitle={onUpdateNodeTitle}
                            />
                        )
                    })}
                </div>
            </motion.div>

            <div className="absolute bottom-6 left-6 z-50 flex flex-col gap-3 pointer-events-auto">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-1 flex items-center self-start">
                    <button onClick={handleZoomOut} className="p-2 hover:bg-gray-50 rounded-md text-gray-500 transition-colors"><ZoomOut size={16} /></button>
                    <div className="w-[1px] h-4 bg-gray-100 mx-1"></div>
                    <button onClick={handleFitView} className="p-2 hover:bg-gray-50 rounded-md text-gray-500 transition-colors"><Maximize size={16} /></button>
                    <div className="w-[1px] h-4 bg-gray-100 mx-1"></div>
                    <button onClick={handleZoomIn} className="p-2 hover:bg-gray-50 rounded-md text-gray-500 transition-colors"><ZoomIn size={16} /></button>
                </div>
            </div>

            <div className="absolute bottom-6 right-6 z-50">
                <Minimap nodes={nodes} activeId={activeNodeId} x={x} y={y} scale={scale} />
            </div>
        </div>
    );
};

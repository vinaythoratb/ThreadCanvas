export enum Author {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT'
}

export enum MessageCategory {
  CONTEXT = 'CONTEXT',
  BRAINSTORM = 'BRAINSTORM',
  REFINEMENT = 'REFINEMENT',
  TANGENT = 'TANGENT',
  DECISION = 'DECISION'
}

export interface Message {
  id: string;
  parentId: string | null;
  author: Author;
  content: string;
  timestamp: number;
  category?: MessageCategory;
  branchId?: string; // If this message starts a new branch
  isHead?: boolean; // Helper for current leaf
  siblingIndex?: number; // For Carousel UI (1 of 3)
  siblingCount?: number; // For Carousel UI
}

export interface Branch {
  id: string;
  label: string;
  startMessageId: string;
  headMessageId: string; // The latest message in this branch
  color: string;
}

export interface Chapter {
  id: string;
  title: string;
  category: MessageCategory;
  startMessageId: string;
  messageCount: number;
  subtopics: string[]; // e.g., ["Cost Analysis", "Safety"]
}

export interface ContextItem {
  id: string;
  type: 'FILE' | 'CONSTRAINT' | 'INSTRUCTION';
  label: string;
  content?: string; // For pinned messages
  addedAt: number;
}
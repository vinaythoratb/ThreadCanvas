import { Author, Branch, Chapter, ContextItem, Message, MessageCategory } from "./types";

// Start with a hidden root message acting as the anchor
export const ROOT_MESSAGE: Message = {
  id: 'root',
  parentId: null,
  author: Author.ASSISTANT,
  content: "SYSTEM_ROOT", // Content is hidden/structural
  timestamp: Date.now(),
  category: MessageCategory.CONTEXT
};

// Initial empty state
export const INITIAL_MESSAGES: Message[] = [ROOT_MESSAGE];

// No chapters initially for new chat
export const INITIAL_CHAPTERS: Chapter[] = [];
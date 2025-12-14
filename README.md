ThreadCanvas is an experimental interface designed for non-linear LLM conversations. Unlike standard chat interfaces, it allows users to branch conversations, visualize them spatially, and carry context between those branches. 

Regarding the demonstration, please refer to the provided video link for a complete overview of the features, as the live application requires valid API keys (such as Gemini or Ollama) to function.
Link - https://youtu.be/JVsldQX4EsQ

The project structure is organized into three main areas. In the core application, App.tsx acts as the main controller, managing the entire application state—including the message tree, active branch, and view mode—while handling the logic for switching between the Linear Chat and Canvas views. The types.ts file defines the core data structures, such as the Message graph nodes and Chapter metadata.

For visualization and user interface, components/CanvasView.tsx serves as the core spatial engine. A custom graph layout algorithm was implemented here using recursion to visualize the conversation tree and grouping logic, removing the need for heavy third-party graphing libraries. components/ContextPanel.tsx implements the "Context Backpack," which manages pinned information that persists across different conversation branches. components/MessageBubble.tsx handles the rendering of chat messages, including the UI controls for branching and swiping between sibling messages. Finally, the services/ directory contains the logic for connecting to the AI backend and handling request streaming.

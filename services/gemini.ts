
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// --- TYPES ---
export type BackendType = 'GEMINI' | 'OLLAMA' | 'SIMULATION';

export const AVAILABLE_GEMINI_MODELS = [
    { id: 'gemini-flash-lite-latest', label: 'Flash Lite (Fast)' },
    { id: 'gemini-2.5-flash', label: 'Flash 2.5 (Balanced)' },
    { id: 'gemini-3-pro-preview', label: 'Pro 3 (Smartest)' },
];

// --- CIRCUIT BREAKER STATE ---
let isGlobalRateLimited = false;
const RATE_LIMIT_COOLDOWN = 60000; // 1 minute cooldown

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to trip the breaker
const handleRateLimit = () => {
    if (!isGlobalRateLimited) {
        console.warn(`[Circuit Breaker] Rate limit hit. Switching to fallbacks.`);
        isGlobalRateLimited = true;
        setTimeout(() => {
            isGlobalRateLimited = false;
            console.log("[Circuit Breaker] Cooldown expired. Retrying live API.");
        }, RATE_LIMIT_COOLDOWN);
    }
};

const MOCK_RESPONSES = [
    "**[Simulation Mode]**\n\nThe Gemini API quota is exhausted and I couldn't reach a local Ollama instance.\n\nTo use a local LLM:\n1. Install Ollama\n2. Run `ollama run llama3`\n3. Start with `OLLAMA_ORIGINS=\"*\" ollama serve`\n\nFor now, you can still test the **Branching UI** and **Canvas View** with this simulated text.",
    "**[Offline Fallback]**\n\nI'm operating in offline mode. If you have **Ollama** running locally (port 11434), I can use that instead! Otherwise, feel free to explore the interface structure.",
];

const streamMockResponse = async (onChunk: (text: string) => void) => {
    const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
    const chars = response.split('');
    let accumulated = '';
    for (let i = 0; i < chars.length; i++) {
        accumulated += chars[i];
        if (i % 3 === 0 || i === chars.length - 1) {
            onChunk(accumulated);
            await sleep(15);
        }
    }
};

// --- OLLAMA LOCAL INTEGRATION ---

const OLLAMA_BASE_URL = 'http://localhost:11434';
let cachedOllamaModel: string | null = null;

// Auto-detect the best available local model
const getOllamaModel = async (): Promise<string> => {
    if (cachedOllamaModel) return cachedOllamaModel;

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        if (!response.ok) throw new Error('Failed to connect to Ollama');

        const data = await response.json();
        const models = data.models || [];

        if (models.length === 0) {
            console.warn("Ollama is running but no models found. Run `ollama pull llama3`");
            return 'llama3';
        }

        // Preference order
        const preferences = ['llama3', 'llama3.1', 'mistral', 'gemma', 'llama2'];

        for (const pref of preferences) {
            const found = models.find((m: any) => m.name.includes(pref));
            if (found) {
                cachedOllamaModel = found.name;
                return found.name;
            }
        }

        // Fallback to the first available model
        cachedOllamaModel = models[0].name;
        return models[0].name;

    } catch (e) {
        console.warn("Could not auto-detect Ollama model (Check CORS?). Defaulting to 'llama3'.", e);
        return 'llama3';
    }
};

const streamOllamaResponse = async (history: { role: string; content: string }[], onChunk: (text: string) => void) => {
    const modelName = await getOllamaModel();
    console.log(`[Ollama] Using model: ${modelName}`);

    // Convert 'user'/'model' to Ollama's 'user'/'assistant'
    const messages = history.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content
    }));

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);
        if (!response.body) throw new Error('No response body from Ollama');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Process all complete lines
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        onChunk(json.message.content);
                    }
                    if (json.done) return;
                } catch (e) {
                    // Ignore parse errors for partial chunks
                }
            }
        }
    } catch (error) {
        console.error("[Ollama Connection Failed]", error);
        throw error;
    }
};

const callOllamaAnalysis = async (prompt: string): Promise<string | null> => {
    try {
        const modelName = await getOllamaModel();
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            })
        });
        if (!response.ok) return null;
        const json = await response.json();
        return json.message?.content || null;
    } catch (e) {
        return null;
    }
};

// --- GEMINI INTEGRATION ---

const executeGeminiStream = async (
    history: { role: string; content: string }[],
    onChunk: (text: string) => void,
    modelIdOverride?: string
): Promise<boolean> => {
    if (!apiKey || isGlobalRateLimited) return false;

    const lastMsg = history[history.length - 1];
    const prevHistory = history.slice(0, -1).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    // Prioritize cheaper models by default, or use override
    let modelsToTry = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3-pro-preview'];

    if (modelIdOverride) {

        // We still keep others as fallback in case of rate limits on the specific model
        modelsToTry = [modelIdOverride, ...modelsToTry.filter(id => id !== modelIdOverride)];
    }

    for (const model of modelsToTry) {
        try {
            const chat = ai.chats.create({
                model: model,
                history: prevHistory,
                config: {
                    systemInstruction: "You are a helpful AI assistant. You are concise, thoughtful, and professional. Use markdown for formatting.",
                }
            });

            const result = await chat.sendMessageStream({ message: lastMsg.content });

            for await (const chunk of result) {
                if (chunk.text) onChunk(chunk.text);
            }
            return true; // Success

        } catch (error: any) {
            const errorMessage = error?.message || '';
            const isRateLimit =
                error?.status === 429 || error?.status === 403 || error?.status === 503 ||
                errorMessage.includes('429') || errorMessage.includes('403') || errorMessage.includes('quota');

            if (isRateLimit) {
                console.warn(`Gemini Quota (${model})... switching to next.`);
                continue;
            }
            // If it's a model not found error (e.g. preview expired), try next
            if (errorMessage.includes('not found') || error?.status === 404) {
                continue;
            }

            console.error("Gemini Error:", error);
            return false;
        }
    }
    // If all models hit rate limit
    handleRateLimit();
    return false;
};

const executeGeminiAnalysis = async (prompt: string): Promise<string | null> => {
    if (!apiKey || isGlobalRateLimited) return null;

    // For analysis, prefer faster models
    const models = ['gemini-flash-lite-latest', 'gemini-2.5-flash'];

    for (const model of models) {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });
            return response.text?.trim() || null;
        } catch (error) { continue; }
    }
    return null;
};


// --- MAIN SERVICE ---

export const streamResponse = async (
    history: { role: string; content: string }[],
    onChunk: (text: string) => void,
    onBackendChange?: (type: BackendType) => void,
    preferredBackend: 'GEMINI' | 'OLLAMA' = 'GEMINI',
    specificModelId?: string
) => {

    // Define strategies
    const tryGemini = async () => {
        const success = await executeGeminiStream(history, onChunk, specificModelId);
        if (success) onBackendChange?.('GEMINI');
        return success;
    };

    const tryOllama = async () => {
        try {
            await streamOllamaResponse(history, onChunk);
            onBackendChange?.('OLLAMA');
            return true;
        } catch (e) {
            // console.warn("Ollama failed (Check CORS or Is Running):", e);
            return false;
        }
    };

    // Determine Execution Order based on preference
    const strategies = preferredBackend === 'OLLAMA'
        ? [tryOllama, tryGemini]
        : [tryGemini, tryOllama];

    // Execute
    for (const strategy of strategies) {
        if (await strategy()) return;
    }

    // Fallback to Simulation
    onBackendChange?.('SIMULATION');
    await streamMockResponse(onChunk);
};

export const analyzeTopicShift = async (
    currentTopic: string | null,
    newMessages: { role: string; content: string }[],
    preferredBackend: 'GEMINI' | 'OLLAMA' = 'GEMINI'
): Promise<string> => {

    if (!currentTopic) {
        return generateInitialTitle(newMessages, preferredBackend);
    }

    const lastUserMessage = newMessages.filter(m => m.role === 'user').pop()?.content || "";
    const lastModelMessage = newMessages.filter(m => m.role === 'model').pop()?.content || "";

    // REFINED PROMPT: Task-Aware Topic Retention
    // Differentiates between "Refining the same thing" vs "Starting a new task"
    const prompt = `
        Role: Context Manager.
        Task: Analyze if the conversation topic has changed based on the last message.

        Context:
        - Current Topic: "${currentTopic}"
        - Last User Message: "${lastUserMessage.slice(0, 300)}"
        - Last AI Response: "${lastModelMessage.slice(0, 300)}"

        Instructions:
        1. Return "SAME" if the user is:
           - Selecting an option from a list (e.g., "I like the second one", "Let's go with X").
           - Asking for tweaks, refinements, or corrections to the current output.
           - Asking a direct follow-up question that clarifies the current specific content.
           - Answering a question asked by the AI.

        2. Return a NEW concise Title (2-4 words) if the user is:
           - Starting a distinct new task or phase (e.g., "Write an email", "Create a playlist", "Draft code").
           - Asking about a specific concept or definition that deviates from the main creative flow (e.g., "What does Dystopian mean?", "Who is X?").
           - Changing the domain completely.
           - Moving from "Brainstorming" phase to "Execution/Drafting" phase.

        Examples:
        - Topic: "Dinner Ideas", User: "Let's do 1920s" -> "SAME" (Selection)
        - Topic: "1920s Party", User: "Write an invite" -> "Party Invitation" (New Task)
        - Topic: "Party Invitation", User: "Make it shorter" -> "SAME" (Refinement)
        - Topic: "Party Invitation", User: "Create a playlist" -> "Party Playlist" (New Task)
        - Topic: "Party Playlist", User: "Who is this artist?" -> "Artist Info" (Tangent)

        Output: ONLY the new Title or "SAME".
    `;

    const tryGemini = async () => {
        const res = await executeGeminiAnalysis(prompt);
        return res;
    };

    const tryOllama = async () => {
        const res = await callOllamaAnalysis(prompt);
        return res;
    };

    const strategies = preferredBackend === 'OLLAMA'
        ? [tryOllama, tryGemini]
        : [tryGemini, tryOllama];

    for (const strategy of strategies) {
        const result = await strategy();
        if (result) {
            const clean = result.trim().replace(/^"|"$/g, '');
            if (clean.toLowerCase() === currentTopic.toLowerCase()) return "SAME";
            // Extra safety: if it returns the exact same string, treat as SAME
            return clean;
        }
    }

    return "SAME";
};

const generateInitialTitle = async (
    messages: { role: string; content: string }[],
    preferredBackend: 'GEMINI' | 'OLLAMA'
): Promise<string> => {
    const text = messages.map(m => m.content).join('\n').slice(0, 500);
    const prompt = `Summarize this conversation start into a concise 2-3 word title. No quotes. Text: ${text}`;

    const tryGemini = async () => await executeGeminiAnalysis(prompt);
    const tryOllama = async () => await callOllamaAnalysis(prompt);

    const strategies = preferredBackend === 'OLLAMA'
        ? [tryOllama, tryGemini]
        : [tryGemini, tryOllama];

    for (const strategy of strategies) {
        const result = await strategy();
        if (result) return result.trim().replace(/^"|"$/g, '');
    }

    return "Conversation Start";
}

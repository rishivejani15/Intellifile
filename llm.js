const path = require("path");
const fs = require("fs");

let session = null;
let context = null;
let model = null;

// Simple text chunker
function chunkText(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

// Basic keyword similarity scorer
function findRelevantChunks(query, text, topK = 3) {
    const chunks = chunkText(text);
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    if (queryWords.length === 0) return chunks.slice(0, topK);

    const scoredChunks = chunks.map(chunk => {
        let score = 0;
        const lowerChunk = chunk.toLowerCase();
        queryWords.forEach(word => {
            if (lowerChunk.includes(word)) score++;
        });
        return { chunk, score };
    });

    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, topK).map(item => item.chunk);
}

async function initModel() {
    if (model) return;

    try {
        const { getLlama } = await import("node-llama-cpp");

        const llama = await getLlama();
        const modelPath = path.join(__dirname, "models", "model.gguf");

        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model not found at ${modelPath}. Please ensure 'model.gguf' exists.`);
        }

        console.log("Loading GGUF Model...");
        model = await llama.loadModel({
            modelPath: modelPath,
        });

        context = await model.createContext();
        session = new (await import("node-llama-cpp")).LlamaChatSession({
            contextSequence: context.getSequence(),
        });

        console.log("GGUF Model Loaded Successfully!");
    } catch (error) {
        console.error("Failed to load LLM:", error);
        throw error;
    }
}

async function chat(query, documentContent, onTokenCallback) {
    if (!model) await initModel();

    // RAG: Retrieve relevant context
    const relevantChunks = findRelevantChunks(query, documentContent, 3);
    const contextText = relevantChunks.join("\n...\n");

    // STRICT PROMPT as requested
    const finalPrompt = `You are a document question-answering assistant.

Your task is to answer the user’s question using ONLY the information
provided in the retrieved document context.

Rules you MUST follow:
1. Use ONLY the given context to answer.
2. If the answer is NOT present in the context, say:
   "I couldn't find that in the uploaded document."
3. Do NOT use prior knowledge or make assumptions.
4. Do NOT hallucinate or invent details.
5. Keep answers concise, clear, and factual.
6. When possible, include citations using page numbers like (p. 3).

Answer style:
- Short paragraphs or bullet points
- No unnecessary explanations
- No repetition
- No emojis

Context:
${contextText}

Question:
${query}

Answer:`;

    if (onTokenCallback) onTokenCallback("Thinking... ");

    let fullResponse = "";

    // FIX: Don't create new sessions endlessly which consumes context sequences.
    // Instead, reuse the session if possible, OR dispose the old one.
    // For simplicity and stability with a single context, we initialize session ONCE in initModel.
    // Then here we just use it.

    if (!session) {
        session = new (await import("node-llama-cpp")).LlamaChatSession({
            contextSequence: context.getSequence(),
        });
    }

    // To ensure "stateless" behavior in a stateful session, we can just reset conversation history manually
    // using the correct internal method or by managing prompt construction manually without using session history features if needed.
    // However, node-llama-cpp v3 session management is tricky. 
    // EASIEST FIX: Just rely on the "System Prompt" to override previous context bias, 
    // or explicitly properly dispose the previous sequence if we wanted new ones.
    //
    // BUT: reusing the single session is safest against "No sequences left".
    // We will simply rely on the strong System Prompt to define strict context for THIS turn.


    await session.prompt(finalPrompt, {
        maxTokens: 512,
        temperature: 0.1, // Very low temp for strict adherence
        topP: 0.9,
        onToken: (chunk) => {
            const token = model.detokenize(chunk);
            fullResponse += token;
            if (onTokenCallback) onTokenCallback(token);
        }
    });

    return fullResponse;
}

module.exports = { chat };

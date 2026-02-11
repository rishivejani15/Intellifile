const path = require("path");
const fs = require("fs");

let llama = null;
let chatModel = null;
let embedModel = null;
let chatContext = null;
let embedContext = null;
let session = null;

let chunks = [];
let chunkEmbeddings = [];

// Cosine similarity
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Better paragraph-aware chunking
function chunkText(text, maxChars = 1500) {
  if (!text) return [];
  // normalize newlines
  const normalizedText = text.replace(/\r\n/g, "\n");
  const trimmed = normalizedText.trim();

  if (trimmed.length === 0) return [];

  if (normalizedText.length <= maxChars) {
    return [trimmed];
  }

  // Try splitting by double newlines first (paragraphs)
  let initialChunks = normalizedText.split(/\n\s*\n/);

  // If we only have 1 chunk (or few) and the text is large, it might be a CSV or Code file
  // so we split by single newlines.
  if (initialChunks.length < 2 && normalizedText.length > maxChars) {
    initialChunks = normalizedText.split("\n");
  }

  const finalChunks = [];
  let currentChunk = "";

  for (const piece of initialChunks) {
    const trimmedPiece = piece.trim();
    if (!trimmedPiece) continue;

    const toAdd = (currentChunk ? "\n" : "") + trimmedPiece;

    if (currentChunk.length + toAdd.length > maxChars) {
      if (currentChunk) finalChunks.push(currentChunk);
      // If the piece itself is larger than maxChars, we must split it hard
      if (trimmedPiece.length > maxChars) {
        let start = 0;
        while (start < trimmedPiece.length) {
          finalChunks.push(trimmedPiece.slice(start, start + maxChars));
          start += maxChars;
        }
        currentChunk = "";
      } else {
        currentChunk = trimmedPiece;
      }
    } else {
      currentChunk += (currentChunk ? "\n" : "") + trimmedPiece;
    }
  }

  if (currentChunk) finalChunks.push(currentChunk);

  return finalChunks;
}

async function initModels() {
  if (chatModel && embedModel) return;

  const { getLlama } = await import("node-llama-cpp");
  llama = await getLlama();

  const chatPath = path.join(__dirname, "models", "qwen2.5-3b-instruct-q4_k_m.gguf");
  const embedPath = path.join(__dirname, "models", "nomic-embed.gguf");

  if (!fs.existsSync(chatPath)) throw new Error("Chat model not found");
  if (!fs.existsSync(embedPath)) throw new Error("Embedding model not found");

  console.log("Loading models...");

  // Load models initially - contexts will be created as needed to manage memory if necessary
  // But for better performance, we keep them if possible. 
  // Given the error "Failed to create context", we should be careful.

  chatModel = await llama.loadModel({ modelPath: chatPath });
  embedModel = await llama.loadModel({ modelPath: embedPath });

  console.log("Models loaded successfully");
}

async function getEmbedding(text) {
  if (!embedContext) {
    embedContext = await embedModel.createEmbeddingContext();
  }
  const embedding = await embedContext.getEmbeddingFor(text);
  return embedding.vector;
}

async function ingestDocument(text) {
  await initModels();

  console.log(`Ingesting document. Text length: ${text ? text.length : 0}`);

  if (!text || text.trim().length === 0) {
    console.warn("Document text is empty!");
  }

  console.log("Chunking document...");
  chunks = chunkText(text);

  if (chunks.length === 0 && text && text.trim().length > 0) {
    console.log("Chunking resulted in 0 chunks, but text exists. Using full text as one chunk.");
    chunks.push(text.slice(0, 2000)); // Cap it just in case, though chunkText should have handled it
  }

  console.log(`Created ${chunks.length} chunks.`);
  chunkEmbeddings = [];

  console.log(`Embedding ${chunks.length} chunks...`);

  // Ensure embed context exists
  if (!embedContext) {
    embedContext = await embedModel.createEmbeddingContext();
  }

  for (const chunk of chunks) {
    // Nomic specific prefix if needed, but usually raw text is fine or check documentation
    // Nomic embed v1.5 usually wants "search_document: " prefix for docs
    const vector = await getEmbedding(`search_document: ${chunk}`);
    chunkEmbeddings.push(vector);
  }

  // We can dispose embed context here if we want to save VRAM for chat, 
  // but we need it for query embedding later. 
  // If VRAM is tight, we might need to swap contexts.
  // For now, let's keep it.

  console.log("Document ingested and ready");
}

async function getRelevantChunks(query, topK = 5) {
  if (chunks.length === 0) return [];

  // Nomic specific prefix for queries
  const qVec = await getEmbedding(`search_query: ${query}`);

  const scores = chunkEmbeddings.map((emb, i) => ({
    index: i,
    score: cosineSimilarity(qVec, emb)
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map(s => chunks[s.index]);
}

async function chat(query, onTokenCallback) {
  await initModels();

  if (chunks.length === 0) {
    const msg = "I have no document context to answer from. Please upload a valid document with text content.";
    if (onTokenCallback) onTokenCallback(msg);
    return msg;
  }

  let relevantChunks = [];
  try {
    let topK = 5;
    const lowerQuery = query.toLowerCase();

    // Dynamic Top-K Strategy
    if (lowerQuery.includes("summarize") ||
      lowerQuery.includes("summary") ||
      lowerQuery.includes("overview") ||
      lowerQuery.includes("describe") ||
      lowerQuery.includes("what is this") ||
      lowerQuery.includes("content") ||
      chunks.length <= 15) {  // Short docs: use everything
      topK = chunks.length;
    }

    console.log(`Query: "${query}" | Chunks: ${chunks.length} | Using Top-K: ${topK}`);
    relevantChunks = await getRelevantChunks(query, topK);
  } catch (err) {
    console.error("Embedding lookup failed:", err);
    // Fallback: use first chunk if available
    if (chunks.length > 0) relevantChunks = [chunks[0]];
    // If it was a real error preventing retrieval, we might want to notify, 
    // but fallback often works for simple cases.
  }

  const contextText = relevantChunks.length > 0
    ? relevantChunks.join("\n---\n")
    : "";

  const userPrompt = contextText
    ? `Document context:\n${contextText}\n\nQuestion: ${query}`
    : `Question: ${query}`;

  if (onTokenCallback) onTokenCallback("Thinking... ");

  // Create chat context if not exists
  if (!chatContext) {
    chatContext = await chatModel.createContext({ contextSize: 8192 });
  }

  const { LlamaChatSession } = await import("node-llama-cpp");

  if (!session) {
    session = new LlamaChatSession({
      contextSequence: chatContext.getSequence(),
      systemPrompt: `You are a helpful and precise document assistant.
Use the provided document context to answer the user's question.
- For specific facts, verify they are in the context.
- For summaries or overviews, synthesize the available information.
- If the answer is not in the document, state that clearly.
- Maintain a professional and helpful tone.`
    });
  }

  let fullResponse = "";

  try {
    const response = await session.prompt(userPrompt, {
      temperature: 0.1,
      maxTokens: 1024,
      onToken: (chunkIds) => {
        const token = chatModel.detokenize(chunkIds);
        fullResponse += token;
        if (onTokenCallback) onTokenCallback(token);
      }
    });

    // If 'response' is returned as string (api v3), we are good.
    // If it relies on onToken purely, we are also good.
    if (!fullResponse && typeof response === 'string') {
      fullResponse = response;
    }
  } catch (err) {
    console.error("Chat generation failed:", err);
    if (onTokenCallback) onTokenCallback("Error generating response: " + err.message);
  }

  return fullResponse;
}

module.exports = { chat, ingestDocument };
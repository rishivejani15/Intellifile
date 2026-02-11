import { useState, useRef, useEffect } from "react";

export default function Chatbot() {
    const [messages, setMessages] = useState([
        {
            role: "assistant",
            content: "Hello! I'm your AI assistant. You can upload PDF, Word, Excel, or PowerPoint files to get started.",
        },
    ]);
    const [input, setInput] = useState("");
    const [file, setFile] = useState(null);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleUpload = async () => {
        const res = await window.electronAPI.openFile();
        if (res) {
            const fileName = res.filePath.split(/[\\/]/).pop();
            setFile({ filePath: res.filePath });
            addMessage("user", `Uploaded: ${fileName}`);

            // Ingest the content in backend
            try {
                await window.electronAPI.ingestDocument(res.filePath);
                addMessage("assistant", `I've loaded the document "${fileName}". Ask me anything about it!`);
            } catch (err) {
                addMessage("assistant", "Error loading document for analysis.");
            }
        }
    };

    const addMessage = (role, content) => {
        setMessages((prev) => [...prev, { role, content }]);
    };

    useEffect(() => {
        // Cleanup listeners on unmount
        return () => {
            window.electronAPI.removeAllChatListeners();
        };
    }, []);

    const sendMessage = async () => {
        if (!input.trim()) return;

        const userMessage = input;
        setInput("");
        addMessage("user", userMessage);

        if (!file) {
            setTimeout(() => {
                addMessage("assistant", "Please upload a document first.");
            }, 500);
            return;
        }

        // Add placeholder for AI response
        setMessages((prev) => [...prev, { role: "assistant", content: "Thinking..." }]);

        // Setup Listeners
        window.electronAPI.removeAllChatListeners(); // Clear old ones

        let currentResponse = "";

        window.electronAPI.onChatToken((token) => {
            currentResponse += token;
            setMessages((prev) => {
                const newMsgs = [...prev];
                // Identify the last message as the one we are streaming into
                // If it was "Thinking...", we replace it.
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg.role === "assistant") {
                    lastMsg.content = currentResponse;
                }
                return newMsgs;
            });
        });

        window.electronAPI.onChatDone(() => {
            console.log("Chat done");
            // Optional: Clean up or finalize UI
        });

        window.electronAPI.onChatError((err) => {
            setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err}` }]);
        });

        // Start Streaming
        window.electronAPI.startChat(userMessage);
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter") sendMessage();
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
            <h1>
                AI Chatbot <span style={badge}>Beta</span>
            </h1>
            <p style={{ opacity: 0.7, marginBottom: 20 }}>
                Chat with your documents and get instant answers
            </p>

            {/* Chat Area */}
            <div style={chatContainer}>
                <div style={messagesList}>
                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            style={{
                                ...messageBubble,
                                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                                background: msg.role === "user" ? "#6d4aff" : "#1e293b",
                                borderBottomRightRadius: msg.role === "user" ? 4 : 16,
                                borderBottomLeftRadius: msg.role === "assistant" ? 4 : 16,
                            }}
                        >
                            <strong>{msg.role === "assistant" ? "🤖 AI" : "👤 You"}</strong>
                            <div style={{ marginTop: 4 }}>{msg.content}</div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div style={inputArea}>
                    <button style={uploadBtn} onClick={handleUpload} title="Upload Document">
                        📎
                    </button>
                    <input
                        style={inputStyle}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={file ? `Ask about ${file.filePath}...` : "Type a message..."}
                    />
                    <button style={sendBtn} onClick={sendMessage}>
                        ➤
                    </button>
                </div>
            </div>
        </div>
    );
}

const badge = {
    background: "linear-gradient(90deg, #6d4aff, #8b5cf6)",
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 12,
    marginLeft: 10,
};

const chatContainer = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#0f172a",
    borderRadius: 16,
    overflow: "hidden",
    border: "1px solid #1e293b",
};

const messagesList = {
    flex: 1,
    padding: 20,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
};

const messageBubble = {
    maxWidth: "80%",
    padding: "12px 16px",
    borderRadius: 16,
    lineHeight: 1.5,
    color: "#fff",
};

const inputArea = {
    padding: 16,
    background: "#1e293b",
    display: "flex",
    gap: 10,
    alignItems: "center",
};

const inputStyle = {
    flex: 1,
    background: "#0f172a",
    border: "1px solid #334155",
    padding: "12px 16px",
    borderRadius: 24,
    color: "#fff",
    outline: "none",
    fontSize: 16,
};

const sendBtn = {
    background: "#6d4aff",
    border: "none",
    width: 44,
    height: 44,
    borderRadius: "50%",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
};

const uploadBtn = {
    background: "transparent",
    border: "1px solid #334155",
    width: 44,
    height: 44,
    borderRadius: "50%",
    color: "#94a3b8",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    transition: "all 0.2s",
};

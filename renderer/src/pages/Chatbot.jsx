import { useState, useRef, useEffect } from "react";

export default function Chatbot() {
    console.log("DEBUG: Chatbot component loaded");

    const [messages, setMessages] = useState([
        {
            role: "assistant",
            content: "Hello! I'm your AI assistant. You can upload PDF, Word, Excel, or PowerPoint files to get started.",
        },
    ]);
    const [input, setInput] = useState("");
    const [file, setFile] = useState(null);
    const messagesEndRef = useRef(null);

    const [modelStatus, setModelStatus] = useState("checking"); // checking, ready, missing, error, loading_chat
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    useEffect(() => {
        if (modelStatus === "loading_chat") {
            const interval = setInterval(() => {
                checkStatus();
            }, 2000); // Check every 2 seconds
            return () => clearInterval(interval);
        }
    }, [modelStatus]);

    const checkStatus = async () => {
        try {
            const status = await window.electronAPI.checkModelStatus();
            console.log("DEBUG: Model status:", status);
            if (status && status.chat_model !== "loaded") {
                setModelStatus("loading_chat");
            } else if (status && status.embedding_model === "loaded") {
                setModelStatus("ready");
            } else {
                setModelStatus("missing");
            }
        } catch (e) {
            console.error("Failed to check model status:", e);
            setModelStatus("error");
        }
    };

    const handleDownloadModel = async () => {
        setIsDownloading(true);
        try {
            await window.electronAPI.downloadModel();
            setModelStatus("ready");
        } catch (e) {
            console.error("Download failed", e);
            alert("Failed to download model. Check logs.");
        } finally {
            setIsDownloading(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm("Are you sure you want to clear all uploaded documents and chat history?")) return;

        try {
            await window.electronAPI.resetApp();
            setMessages([{
                role: "assistant",
                content: "Knowledge base cleared. You can upload new documents now.",
            }]);
            setFile(null);
            addMessage("assistant", "All data has been reset.");
        } catch (e) {
            console.error("Reset failed", e);
            alert("Failed to reset app.");
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        return () => {
            window.electronAPI.removeAllChatListeners();
        };
    }, []);

    const handleUpload = async () => {
        const res = await window.electronAPI.openFile();
        if (res) {
            const fileName = res.filePath.split(/[\\/]/).pop();
            setFile({ filePath: res.filePath });
            addMessage("user", `Uploaded: ${fileName}`);

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

        setMessages((prev) => [...prev, { role: "assistant", content: "Thinking..." }]);
        window.electronAPI.removeAllChatListeners();

        let currentResponse = "";

        window.electronAPI.onChatToken((token) => {
            currentResponse += token;
            setMessages((prev) => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg.role === "assistant") {
                    lastMsg.content = currentResponse;
                }
                return newMsgs;
            });
        });

        window.electronAPI.onChatDone(() => {
            console.log("DEBUG: Chat done");
        });

        window.electronAPI.onChatError((err) => {
            setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err}` }]);
        });

        window.electronAPI.startChat(userMessage);
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter") sendMessage();
    };

    if (modelStatus === "checking") {
        return <div style={centerStyle}>
            <h3>Connecting to AI Services...</h3>
        </div>;
    }

    if (modelStatus === "loading_chat") {
        return <div style={centerStyle}>
            <div style={cardStyle}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
                <h2 style={{ margin: "0 0 10px 0", color: "#fff" }}>Loading Chat Model</h2>
                <p style={{ lineHeight: 1.6, marginBottom: 20 }}>
                    Initializing the AI chat model. This may take a moment...
                </p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        border: '4px solid #f3f3f3',
                        borderTop: '4px solid #3498db',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }}></div>
                </div>
                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>;
    }

    if (modelStatus === "missing") {
        return (
            <div style={centerStyle}>
                <div style={cardStyle}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
                    <h2 style={{ margin: "0 0 10px 0", color: "#fff" }}>Setup AI Model</h2>
                    <p style={{ lineHeight: 1.6, marginBottom: 20 }}>
                        To ensure efficient, <strong>offline-first</strong> processing, we need to download the embedding model once.
                    </p>
                    <button
                        style={{
                            ...primaryBtnStyle,
                            opacity: isDownloading ? 0.7 : 1,
                            cursor: isDownloading ? "not-allowed" : "pointer"
                        }}
                        onClick={handleDownloadModel}
                        disabled={isDownloading}
                    >
                        {isDownloading ? "Downloading Model..." : "Download Model (~90MB)"}
                    </button>
                    {isDownloading && (
                        <p style={{ fontSize: 13, marginTop: 15, color: "#94a3b8" }}>
                            Please wait, this may take a few moments depending on your connection.
                        </p>
                    )}
                </div>
            </div>
        );
    }

    if (modelStatus === "error") {
        return (
            <div style={centerStyle}>
                <h3 style={{ color: "#ef4444" }}>Connection Error</h3>
                <p>Could not connect to the backend service. Check if the server is running.</p>
                <button style={primaryBtnStyle} onClick={checkStatus}>Retry</button>
            </div>
        );
    }

    return (
        <div style={containerStyle}>
            {/* Header Section */}
            <div style={headerStyle}>
                <div>
                    <h1 style={titleStyle}>
                        AI Chatbot <span style={badgeStyle}>Beta</span>
                    </h1>
                    <p style={subtitleStyle}>Chat with your documents and get instant answers</p>
                </div>
                <button
                    style={resetBtnStyle}
                    onClick={handleReset}
                    title="Clear all uploaded documents and reset chat"
                >
                    Clear Context
                </button>
            </div>


            {/* Chat Area */}
            <div style={chatWindowStyle}>
                <div style={messagesContainerStyle}>
                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            style={{
                                ...messageRowStyle,
                                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                            }}
                        >
                            {msg.role === "assistant" && (
                                <div style={avatarStyle}>
                                    <RobotIcon />
                                </div>
                            )}

                            <div
                                style={{
                                    ...bubbleStyle,
                                    background: msg.role === "user"
                                        ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
                                        : "#1e293b",
                                    color: "#fff",
                                    borderBottomRightRadius: msg.role === "user" ? 4 : 20,
                                    borderBottomLeftRadius: msg.role === "assistant" ? 4 : 20,
                                    boxShadow: msg.role === "user"
                                        ? "0 4px 12px rgba(99, 102, 241, 0.3)"
                                        : "0 2px 4px rgba(0,0,0,0.1)",
                                }}
                            >
                                <div style={messageContentStyle}>{msg.content}</div>
                            </div>

                            {msg.role === "user" && (
                                <div style={{ ...avatarStyle, background: '#4f46e5' }}>
                                    <UserIcon />
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div style={inputContainerStyle}>
                    <div style={inputWrapperStyle}>
                        <button
                            style={iconButtonStyle}
                            onClick={handleUpload}
                            title="Upload Document"
                            onMouseEnter={(e) => e.target.style.background = "rgba(255,255,255,0.1)"}
                            onMouseLeave={(e) => e.target.style.background = "transparent"}
                        >
                            <PaperclipIcon />
                        </button>
                        <input
                            style={inputFieldStyle}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder={file ? `Ask about ${file.filePath.split(/[\\/]/).pop()}...` : "Type a message..."}
                        />
                        <button
                            style={sendButtonStyle}
                            onClick={sendMessage}
                            disabled={!input.trim()}
                        >
                            <SendIcon />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Icons ---

const RobotIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
);

const UserIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

const PaperclipIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
);

const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
);


// --- Styles ---

const containerStyle = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    color: "#e2e8f0",
    overflow: "hidden", // Prevent outer scroll
};

const headerStyle = {
    marginBottom: 20,
    flexShrink: 0,
};

const titleStyle = {
    fontSize: "2rem", // Smaller than 3.2em
    fontWeight: 700,
    margin: 0,
    background: "linear-gradient(to right, #fff, #94a3b8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    display: "flex",
    alignItems: "center",
    gap: 12,
};

const badgeStyle = {
    background: "rgba(139, 92, 246, 0.2)",
    color: "#a78bfa",
    fontSize: "0.8rem",
    padding: "4px 8px",
    borderRadius: "12px",
    fontWeight: 600,
    border: "1px solid rgba(139, 92, 246, 0.3)",
    WebkitTextFillColor: "#a78bfa", // Reset override
};

const subtitleStyle = {
    color: "#64748b",
    margin: "8px 0 0 0",
    fontSize: "0.95rem",
};

const chatWindowStyle = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#0f172a", // Darker background for chat
    borderRadius: 24,
    border: "1px solid #1e293b",
    overflow: "hidden",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
    position: "relative",
};

const messagesContainerStyle = {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    scrollBehavior: "smooth",
};

const messageRowStyle = {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    width: "100%",
};

const avatarStyle = {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#334155",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: "#e2e8f0",
};

const bubbleStyle = {
    padding: "16px 20px",
    borderRadius: 20,
    maxWidth: "70%",
    lineHeight: 1.6,
    border: "1px solid rgba(255,255,255,0.05)",
    fontSize: "0.95rem",
    wordBreak: "break-word",
};

const messageContentStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
};

const inputContainerStyle = {
    padding: "16px 24px",
    background: "rgba(15, 23, 42, 0.95)",
    borderTop: "1px solid #1e293b",
    backdropFilter: "blur(10px)",
};

const inputWrapperStyle = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#1e293b",
    padding: "8px 8px 8px 16px",
    borderRadius: "16px", // Pill shape
    border: "1px solid #334155",
    transition: "border-color 0.2s",
};

const inputFieldStyle = {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: "1rem",
    outline: "none",
    minHeight: 24,
};

const iconButtonStyle = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 8,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
};

const sendButtonStyle = {
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    border: "none",
    width: 40,
    height: 40,
    borderRadius: "50%",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
    transition: "transform 0.1s",
};

const centerStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#cbd5e1",
    textAlign: "center",
    padding: 20
};

const cardStyle = {
    background: "#1e293b",
    padding: 40,
    borderRadius: 24,
    border: "1px solid #334155",
    maxWidth: 400,
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)"
};

const primaryBtnStyle = {
    marginTop: 20,
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    color: "white",
    border: "none",
    padding: "12px 24px",
    borderRadius: 12,
    fontSize: 16,
    cursor: "pointer",
    width: "100%",
    fontWeight: 600,
    transition: "opacity 0.2s"
};

const resetBtnStyle = {
    background: "rgba(239, 68, 68, 0.1)", // Red with opacity
    color: "#ef4444",
    border: "1px solid rgba(239, 68, 68, 0.2)",
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: "0.9rem",
    cursor: "pointer",
    fontWeight: 600,
    marginLeft: "auto", // Push to right
    transition: "background 0.2s",
};

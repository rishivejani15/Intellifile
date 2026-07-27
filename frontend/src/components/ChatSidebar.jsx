import React, { useState, useRef, useEffect } from 'react';
import './ChatSidebar.css';
import { showErrorToast, showToast } from '../utils/toast';

function ChatSidebar({ file, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const messagesEndRef = useRef(null);
  const lastIngestedPath = useRef(null);

  useEffect(() => {
    const ingestFile = async () => {
      if (lastIngestedPath.current === file.path) return;

      setIngesting(true);
      try {
        const result = await window.intellifile.ingestFile(file.path);
        lastIngestedPath.current = file.path;

        // Handle different response formats
        let statusMessage = '';
        if (typeof result === 'string') {
          statusMessage = result;
        } else if (result && typeof result === 'object') {
          if (result.error) {
            statusMessage = `Failed to ingest file: ${result.error}`;
            showErrorToast('Could not ingest file.', result.error || 'The file could not be prepared for chat.', 'Close the file in other apps and try again.');
          } else {
            statusMessage = `File "${file.name}" has been ingested. You can now ask me questions about it!`;
            showToast('File ready for chat.', {
              type: 'success',
              message: `"${file.name}" has been added to the chat context.`,
            });
          }
        } else {
          statusMessage = `File "${file.name}" has been ingested. You can now ask me questions about it!`;
          showToast('File ready for chat.', {
            type: 'success',
            message: `"${file.name}" has been added to the chat context.`,
          });
        }

        setMessages([{ role: 'ai', content: statusMessage }]);
      } catch (error) {
      setMessages([{ role: 'ai', content: `Failed to ingest file: ${error.message}` }]);
      showErrorToast('Could not ingest file.', error?.message || 'The file could not be prepared for chat.', 'Close the file in other apps and try again.');
      } finally {
        setIngesting(false);
      }
    };
    if (file?.path) {
      ingestFile();
    }
  }, [file?.path, file?.name]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await window.intellifile.chat(input);
      let responseText = '';

      // Handle different response formats
      if (typeof response === 'string') {
        responseText = response;
      } else if (response && typeof response === 'object') {
        if (response.error) {
          responseText = `Error: ${response.error}`;
          showErrorToast('Chat request failed.', response.error || 'The chat engine rejected the message.', 'Try again after the model finishes loading.');
        } else if (response.response) {
          responseText = response.response;
        } else {
          responseText = JSON.stringify(response);
        }
      } else {
        responseText = String(response || 'No response');
      }

      const aiMessage = { role: 'ai', content: responseText };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage = { role: 'ai', content: `Error: ${error.message || 'Failed to get response'}` };
      setMessages(prev => [...prev, errorMessage]);
      showErrorToast('Chat request failed.', error?.message || 'Failed to get a response.', 'Check your connection or wait for the model to finish loading.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    try {
      await window.intellifile.clearFaiss();
    } catch (error) {
      showErrorToast('Could not clear chat context.', error?.message || 'The local index could not be cleared.', 'Close and reopen the chat panel, then try again.');
    }
    onClose();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <h3>Chat with AI</h3>
        <span className="file-name">{file?.name}</span>
        <button className="close-btn" onClick={handleClose}>×</button>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && !ingesting && (
          <div className="welcome-message">
            Ingesting file... Please wait.
          </div>
        )}
        {ingesting && (
          <div className="welcome-message">
            Ingesting file... Please wait.
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="message ai loading">
            <div className="message-content">Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={!input.trim() || loading}>
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatSidebar;
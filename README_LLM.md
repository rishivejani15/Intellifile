# LLM Setup Instructions

To enable the AI Chatbot features, you need to set up the local LLM environment.

## 1. Install Dependencies
Run the following command in your terminal to install the required Node.js bindings for Llama.cpp:

```bash
npm install
```
*Note: `node-llama-cpp` will be installed. It may require a C++ compiler (Visual Studio Build Tools on Windows, Xcode on Mac) if a prebuilt binary is not available for your system.*

## 2. Download a Model
This application uses **GGUF** quantized models. 

**Recommended Model for low-resource devices (1.3B - 3B):**
- **TinyLlama 1.1B** or **Llama-3.2-1B-Instruct** 
- **Capybara 3B** or **Llama-2-7B-Chat (Int4)** if you have 8GB+ RAM.

**Download Link Examples:**
- [Llama-3.2-1B-Instruct-GGUF](https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF)
- [TinyLlama-1.1B-Chat-v1.0-GGUF](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF)

1. Download a `.gguf` file (e.g., `Llama-3.2-1B-Instruct-Q4_K_M.gguf`).
2. Rename the file to `model.gguf`.
3. Place simple file in the `models` directory at the root of the project:
   ```
   IntelliFile/
   ├── models/
   │   └── model.gguf
   ├── src/
   ├── package.json
   ...
   ```

## 3. Restart the App
Once the model is in place and dependencies are installed:
```bash
npm start
```
The Chatbot page will now be able to load the model and answer questions about your documents!

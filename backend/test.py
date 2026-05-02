from llama_cpp import Llama

llm = Llama(
    model_path="backend/models/qwen2.5-3b-instruct-q5_k_m.gguf",
    n_gpu_layers=-1,
    verbose=True
)
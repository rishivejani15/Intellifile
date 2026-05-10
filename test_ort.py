import os
import glob
import numpy as np
from transformers import AutoTokenizer
import onnxruntime as ort

models_dir = r'backend\models'
# Find the ONNX model file
onnx_files = glob.glob(os.path.join(models_dir, '**', 'model.onnx'), recursive=True)
if not onnx_files:
    print('ONNX model not found!')
    exit(1)
onnx_path = onnx_files[0]
print('Found ONNX at:', onnx_path)

tokenizer = AutoTokenizer.from_pretrained('Xenova/bge-small-en-v1.5', cache_dir=models_dir)
session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])

inputs = tokenizer(['test'], padding=True, truncation=True, return_tensors='np')

ort_inputs = {
    'input_ids': inputs['input_ids'].astype(np.int64),
    'attention_mask': inputs['attention_mask'].astype(np.int64),
    'token_type_ids': inputs['token_type_ids'].astype(np.int64)
}

outputs = session.run(None, ort_inputs)
embeddings = outputs[0][:, 0]
embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)

print('Dimension:', embeddings.shape)
print('First 5 values:', embeddings[0][:5])

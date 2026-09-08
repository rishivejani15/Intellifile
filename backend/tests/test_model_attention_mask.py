"""Guards the ONNX padding-mask contract used by retrieval embeddings."""

import os
import sys
import unittest

import numpy as np

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import core.model as model  # noqa: E402


class _Encoding:
    ids = [101, 7592, 102, 0, 0]
    attention_mask = [1, 1, 1, 0, 0]
    type_ids = [0, 0, 0, 0, 0]


class _Tokenizer:
    def encode_batch(self, _texts):
        return [_Encoding()]


class _Input:
    name = "input_ids"


class _Session:
    def __init__(self):
        self.inputs = None

    def get_inputs(self):
        return [_Input(), type("Mask", (), {"name": "attention_mask"})()]

    def run(self, _unused, inputs):
        self.inputs = inputs
        length = inputs["input_ids"].shape[1]
        return [np.ones((1, length, 4), dtype=np.float32)]


class ModelAttentionMaskTests(unittest.TestCase):
    def test_padding_is_excluded_from_attention_and_sequence_length(self):
        original_tokenizer = model._tokenizer
        original_session = model._session
        original_limit = model._MAX_SEQ_LEN
        fake_session = _Session()
        try:
            model._tokenizer = _Tokenizer()
            model._session = fake_session
            model._MAX_SEQ_LEN = 512

            model._encode(["hello"])

            self.assertEqual(fake_session.inputs["input_ids"].shape, (1, 3))
            self.assertEqual(fake_session.inputs["attention_mask"].tolist(), [[1, 1, 1]])
        finally:
            model._tokenizer = original_tokenizer
            model._session = original_session
            model._MAX_SEQ_LEN = original_limit


if __name__ == "__main__":
    unittest.main()

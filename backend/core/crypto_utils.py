from cryptography.fernet import Fernet
import os

KEY_PATH = "data/secret.key"

def load_key():
    if not os.path.exists(KEY_PATH):
        key = Fernet.generate_key()
        with open(KEY_PATH, "wb") as f:
            f.write(key)
    else:
        with open(KEY_PATH, "rb") as f:
            key = f.read()
    return key

FERNET = Fernet(load_key())

def encrypt_text(text: str) -> bytes:
    return FERNET.encrypt(text.encode("utf-8"))

def decrypt_text(token: bytes) -> str:
    return FERNET.decrypt(token).decode("utf-8")

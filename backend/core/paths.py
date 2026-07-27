import os

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_data_dir():
    data_dir = os.getenv("IF_DATA_DIR")
    if data_dir:
        return data_dir
    return os.path.join(_BACKEND_DIR, "data")


def get_storage_dir():
    return os.path.join(get_data_dir(), "storage")


def get_models_dir():
    models_dir = os.getenv("IF_MODELS_DIR")
    if models_dir:
        return models_dir

    backend_models = os.path.join(_BACKEND_DIR, "models")
    if os.path.isdir(backend_models):
        return backend_models

    return os.path.join(get_data_dir(), "models")

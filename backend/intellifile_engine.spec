# -*- mode: python ; coding: utf-8 -*-
import certifi
from PyInstaller.utils.hooks import collect_data_files
block_cipher = None
_certifi_datas = [(certifi.where(), "certifi")]
a = Analysis(
    ['engine_server.py'],
    pathex=[],
    binaries=[],
     datas=[
        # Bundle certifi's CA bundle so frozen exe can verify HTTPS certs on
        # any end-user machine without relying on the dev-machine venv path.
        *_certifi_datas,
    ],
    hiddenimports=[
        'onnxruntime',
        'tokenizers',
        'huggingface_hub',
        'faiss',
        'numpy',
        'core.search',
        'core.scanner',
        'core.extractor',
        'core.document_preview',
        'pypdf',
        'docx',
        'openpyxl',
        'pptx',
        'core.chunker',
        'core.db',
        'core.model',
        'core.faiss_manager',
        'winrt',
        'winrt.windows.media.ocr',
        'winrt.windows.graphics.imaging',
        'winrt.windows.storage.streams',
        'winrt.windows.globalization',
        'winrt.windows.foundation',
          'winocr',
        # SSL / TLS — must be present in the frozen exe
        'ssl',
        '_ssl',
        '_socket',
        'certifi',
        'truststore',
        'ssl_bootstrap',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'tkinter', 'IPython', 'notebook', 'jupyter', 'pytest',
        # Strip PyTorch, Transformers, and other heavy unused packages
        'torch', 'torchvision', 'torchaudio', 'torch.distributions', 'torch.testing',
        'transformers', 'sentence_transformers', 'scipy', 'pandas', 'sklearn', 'sklearn.datasets', 'skimage',
        'tensorflow', 'keras',
        'antigravity', '_tkinter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=True,
    upx=False,
    name='engine',
)

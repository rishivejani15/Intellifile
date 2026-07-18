# -*- mode: python ; coding: utf-8 -*-
block_cipher = None

a = Analysis(
    ['engine_server.py'],
    pathex=[],
    binaries=[],
    datas=[],
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
        'winocr'
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

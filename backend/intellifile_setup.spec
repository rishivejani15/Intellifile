# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['setup_offline.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'sentence_transformers',
        'onnxruntime'
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'tkinter', 'IPython', 'notebook', 'jupyter', 'pytest',
        'torch', 'torchvision', 'torchaudio', 'torch.distributions', 'torch.testing',
        'scipy', 'pandas', 'sklearn', 'skimage',
        'tensorflow', 'keras',
        'asyncio', 'asyncore',
        'antigravity', '_tkinter', '_ssl', '_socket',
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
    name='setup_offline',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
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
    name='setup',
)

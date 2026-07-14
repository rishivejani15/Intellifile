# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['../sync/server.py'],
    pathex=['../sync'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'uvicorn.commands',
        'fastapi',
        'watchdog',
        'zeroconf',
        # Local modules in sync folder
        'merkle',
        'checksum',
        'vector_clock',
        'watcher',
        'mdns',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'tkinter', 'IPython', 'notebook', 'jupyter', 'pytest',
        'torch', 'torchvision', 'torchaudio', 'torch.distributions', 'torch.testing',
        'transformers', 'sentence_transformers', 'scipy', 'pandas', 'sklearn', 'tensorflow', 'keras',
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
    name='server',
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
    name='server',
)

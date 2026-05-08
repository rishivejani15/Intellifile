# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

block_cipher = None

extra_datas = collect_data_files('llama_cpp')
extra_binaries = collect_dynamic_libs('llama_cpp')

a = Analysis(
    ['engine_server.py'],
    pathex=[],
    binaries=extra_binaries,
    datas=extra_datas,
    hiddenimports=[
        'llama_cpp',
        'torch',
        'sentence_transformers',
        'faiss',
        'numpy',
        'core.search',
        'core.scanner',
        'core.extractor',
        'core.chunker',
        'core.db',
        'core.model',
        'core.faiss_manager'
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'tkinter', 'IPython', 'notebook', 'jupyter', 'pytest'],
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
    upx=True,
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
    strip=False,
    upx=True,
    upx_exclude=[],
    name='engine',
)

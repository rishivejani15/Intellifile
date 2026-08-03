# -*- mode: python ; coding: utf-8 -*-
import certifi
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

# Resolve the CA bundle path at spec-parse time so it works regardless of
# where the venv lives on the build machine.
_certifi_datas = [(certifi.where(), "certifi")]


a = Analysis(
    ['setup_offline.py'],
    pathex=[],
    binaries=[],
     datas=[
        # Bundle certifi's CA bundle so frozen exe can verify HTTPS certs on
        # any end-user machine without relying on the dev-machine venv path.
        *_certifi_datas,
    ],
    hiddenimports=[
        'sentence_transformers',
        
        'onnxruntime',
        # SSL / TLS — must be present in the frozen exe
        'ssl',
        '_ssl',
        '_socket',
        'certifi',
        'truststore',
        # huggingface_hub / requests SSL helpers
        'urllib3',
        'urllib3.contrib',
        'urllib3.contrib.pyopenssl',
        'requests',
        'ssl_bootstrap',
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

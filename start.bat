@echo off
setlocal EnableExtensions
rem ============================================================================
rem Antigravity WebUI - Demarrage Windows
rem Auteur : jprud67 <jprud67@gmail.com>
rem Prerequis : Python 3.10+ et Node.js 18+ dans le PATH, et le CLI
rem             Antigravity (`agy`) disponible (variable AGY_BIN possible).
rem ============================================================================
cd /d "%~dp0"
if not defined PORT set "PORT=8000"
if not defined HOST set "HOST=0.0.0.0"

set "VENV_PY=%~dp0backend\venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo [*] Creation de l'environnement virtuel Python...
    python -m venv "%~dp0backend\venv"
    if errorlevel 1 goto :error
    "%VENV_PY%" -m pip install --upgrade pip
    "%VENV_PY%" -m pip install -r "%~dp0backend\requirements.txt"
    if errorlevel 1 goto :error
)

if not exist "%~dp0frontend\dist\index.html" (
    echo [*] Construction du frontend ^(npm install + npm run build^)...
    pushd "%~dp0frontend"
    call npm install
    if errorlevel 1 (popd & goto :error)
    call npm run build
    if errorlevel 1 (popd & goto :error)
    popd
)

set "PYTHONPATH=%~dp0backend"
echo.
echo [*] Serveur disponible sur :
echo     - Local  : http://localhost:%PORT% (ou http://127.0.0.1:%PORT%)
echo     - Reseau : http://%HOST%:%PORT%
echo     (Ctrl+C pour arreter proprement)
echo.
"%VENV_PY%" -m uvicorn app.main:app --host %HOST% --port %PORT%
goto :eof

:error
echo [!] Echec du demarrage. Verifiez que Python et Node.js sont bien installes et dans le PATH.
exit /b 1

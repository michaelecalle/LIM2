@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM --- Se placer dans le dossier du script
cd /d "%~dp0"

echo ==========================
echo LIMGPT - AUTO PUSH
echo ==========================
echo.
echo Dossier courant :
echo %cd%

echo.
echo ===== PROTECTION DES FICHIERS NORMALISES =====
call :protect_file "src/data/normalized/ligneFT.normalized.ts"
if errorlevel 1 goto :git_error
call :protect_file "src/data/ligneFT.normalized.json"
if errorlevel 1 goto :git_error
call :protect_file "src/data/ltv.normalized.json"
if errorlevel 1 goto :git_error
echo Protection terminee : les fichiers normalises operationnels ne seront pas inclus dans ce push.

echo.
echo --- git status ---
git status
if errorlevel 1 goto :git_error

REM --- Vérifier s'il y a quelque chose à commit
set HASCHANGES=
for /f %%A in ('git status --porcelain') do set HASCHANGES=1
if not defined HASCHANGES (
  echo.
  echo Rien a commit : working tree propre.
  goto :end
)

REM --- Ecrire src/buildInfo.ts avec date/heure lisible
set BUILD_TIME=%date% %time%
set BUILD_TIME=%BUILD_TIME:~0,-3%

echo export const BUILD_TIME = "%BUILD_TIME%";> src\buildInfo.ts
echo export const BUILD_HASH = "";>> src\buildInfo.ts

echo.
echo --- buildInfo.ts genere ---
type src\buildInfo.ts

echo.
echo --- git add -A ---
git add -A
if errorlevel 1 goto :git_error

echo.
echo ===== RETRAIT DE SECURITE DES FICHIERS NORMALISES =====
call :protect_file "src/data/normalized/ligneFT.normalized.ts"
if errorlevel 1 goto :git_error
call :protect_file "src/data/ligneFT.normalized.json"
if errorlevel 1 goto :git_error
call :protect_file "src/data/ltv.normalized.json"
if errorlevel 1 goto :git_error
echo Les fichiers normalises sont exclus de l'index Git.

REM --- Message de commit automatique avec date/heure stable
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "COMMIT_DATETIME=%%I"
set "MSG=Commit LIM2 - %COMMIT_DATETIME%"

echo.
echo --- git commit ---
echo Message: "!MSG!"
git commit -m "!MSG!"
if errorlevel 1 goto :git_error

echo.
echo --- git pull --rebase ---
git pull --rebase origin main
if errorlevel 1 goto :git_error

echo.
echo --- git push ---
git push
if errorlevel 1 goto :git_error

echo.
echo Push termine avec succes.
goto :end

:protect_file
set "PROTECTED_FILE=%~1"

git ls-files --error-unmatch "%PROTECTED_FILE%" >nul 2>nul
if errorlevel 1 (
    if exist "%PROTECTED_FILE%" (
        echo Suppression locale non suivie du fichier protege : %PROTECTED_FILE%
        del /f /q "%PROTECTED_FILE%"
        if errorlevel 1 exit /b 1
    )
    exit /b 0
)

git restore --staged -- "%PROTECTED_FILE%" >nul 2>nul
git restore --worktree -- "%PROTECTED_FILE%" >nul 2>nul
if errorlevel 1 exit /b 1

exit /b 0

:git_error
echo.
echo Erreur git. Arret.
echo.
git status
pause
endlocal
exit /b 1

:end
echo.
pause
endlocal
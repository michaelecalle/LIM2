@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM --- Se placer dans le dossier du script (utile si tu double-cliques dessus)
cd /d "%~dp0"

echo ==========================
echo LIMGPT - AUTO PUSH
echo ==========================

REM --- 1) git status
echo.
echo --- git status ---
git status
if errorlevel 1 goto :git_error

REM --- 2) Vérifier s'il y a quelque chose à commit (working tree propre ?)
for /f %%A in ('git status --porcelain') do set HASCHANGES=1
if not defined HASCHANGES (
  echo.
  echo Rien a commit : working tree propre.
  goto :end
)

REM --- 3) git add (tous les fichiers listes par status)
REM git add -A est l'equivalent pratique : ajoute modifs + nouveaux fichiers + suppressions
REM --- 3bis) Ecrire src/buildInfo.ts avec date/heure lisible (BUILD_TIME)
set BUILD_TIME=%date% %time%
set BUILD_TIME=%BUILD_TIME:~0,-3%

REM Echapper les backslashes et quotes si besoin (simple ici : on garde en texte brut)
echo export const BUILD_TIME = "%BUILD_TIME%";> src\buildInfo.ts
echo export const BUILD_HASH = "";>> src\buildInfo.ts

echo.
echo --- buildInfo.ts genere ---
type src\buildInfo.ts

echo.
echo --- git add -A ---
git add -A
if errorlevel 1 goto :git_error

REM --- 4) Message de commit = date + heure (format propre et stable)
for /f "tokens=1-3 delims=/- " %%a in ("%date%") do (
  set D1=%%a
  set D2=%%b
  set D3=%%c
)
for /f "tokens=1-2 delims=: " %%h in ("%time%") do (
  set H=%%h
  set M=%%i
)

REM Selon la config Windows, %date% peut etre dans un ordre différent.
REM On construit un message "Commit du JJ-MM-AAAA HHhMM" sans se prendre la tete :
set MSG=Commit du %date% %time%
REM Nettoyage : enlever les secondes et les centiemes si tu veux (optionnel)
set MSG=!MSG:~0,-3!

echo.
echo --- git commit ---
echo Message: "!MSG!"
git commit -m "!MSG!"
if errorlevel 1 goto :git_error

REM --- 5) git push
echo.
echo --- git push ---
git push
if errorlevel 1 goto :git_error

echo.
echo ✅ Push termine.
goto :end

:git_error
echo.
echo ❌ Erreur git. Arret.
echo.
pause
endlocal
exit /b 1

:end
echo.
pause
endlocal

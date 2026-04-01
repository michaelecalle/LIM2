@echo off
cd /d "%~dp0"
echo ==============================
echo EXPORT KML RUBAN + ANCRES
echo ==============================

where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js n'est pas disponible dans le PATH.
  echo Verifie l'installation de Node.js.
  echo.
  pause
  exit /b 1
)

node scripts/export_kml_ruban_ancres.cjs

echo.
pause
@echo off
cd /d "C:\Dev\limgpt - V2"

echo -----------------------------------------
echo     Incrementation du numero de version
echo -----------------------------------------
node tools\bump-version.mjs

echo.
echo Lancement de LIMGPT V2 (Vite) dans une nouvelle fenetre...
echo Tu pourras fermer LIMGPT V2 en fermant cette nouvelle fenetre.
echo -----------------------------------------
echo.

start cmd /K "cd /d C:\Dev\limgpt - V2 && echo [LIMGPT V2] Demarrage serveur dev... && npm run dev && echo. && echo [LIMGPT V2] Serveur arrete. && pause"

echo.
echo (Cette fenetre-ci peut etre fermee.)
@echo off
cd /d "%~dp0"
rmdir /s /q .git 2>nul
echo # TrainMetrics > README.md
echo. >> README.md
echo App de seguimiento de entrenamiento (PWA), 100%% local. >> README.md
git init
git add .
git commit -m "TrainMetrics: PWA de seguimiento de entrenamiento"
git branch -M main
git remote add origin https://github.com/jignacio-arasano/laiwei.git
git push -u origin main
echo.
echo ==== LISTO (revisa arriba si hubo errores) ====
pause

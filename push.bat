@echo off
cd /d "%~dp0"
del serve.bat
git add -A
git commit -m "Agregar modulo de dieta: perfil, alimentos, comidas y registro de peso, con plan nutricional precargado"
git push
echo.
echo LISTO. Podes cerrar esta ventana.
pause

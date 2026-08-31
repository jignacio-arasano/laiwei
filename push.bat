@echo off
cd /d "%~dp0"
del serve.bat
git add -A
git commit -m "Musculos secundarios, fatiga sistemica cruzada, suavizado de peso y ajuste dinamico de TDEE"
git push
echo.
echo LISTO. Podes cerrar esta ventana.
pause

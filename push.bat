@echo off
cd /d "%~dp0"
del serve.bat
git add -A
git commit -m "Numerar orden de ejercicios en Sesion y agregar diagnostico de estancamiento (dieta x entrenamiento)"
git push
echo.
echo LISTO. Podes cerrar esta ventana.
pause

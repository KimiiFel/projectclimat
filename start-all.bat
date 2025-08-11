@echo off
REM Démarre tout dans des fenêtres séparées
start "Hardhat Node" cmd /k "cd /d blockchain && npx hardhat node"
timeout /t 2 >nul
start "Gateway"      cmd /k "cd /d gateway-server && node index.js"
start "Mock"         cmd /k "cd /d gateway-server && node mock.js"
start "UI"           cmd /k "cd /d ui && npm run dev"

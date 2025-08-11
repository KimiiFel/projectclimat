@echo off
setlocal

REM 1) Démarre le nœud Hardhat
start "Hardhat Node" cmd /k "cd /d blockchain && npx hardhat node"
echo [start-all] Attente que le RPC 8545 soit prêt...
powershell -NoProfile -Command "while(-not (Test-NetConnection 127.0.0.1 -Port 8545 -WarningAction SilentlyContinue).TcpTestSucceeded){ Start-Sleep -Seconds 1 }"

REM 2) Déploie le contrat (nouvelle chaîne = nouveau déploiement)
for /f "delims=" %%A in ('cmd /c "cd blockchain && npx hardhat run scripts/deploy.js --network localhost"') do set LASTLINE=%%A
echo [start-all] %LASTLINE%

REM 3) Extrait l'adresse (format: 'SensorRegistryV2: 0x....')
for /f "tokens=2 delims=:" %%B in ("%LASTLINE%") do set CONTRACT=%%B
set CONTRACT=%CONTRACT: =%

if "%CONTRACT%"=="" (
  echo [start-all] Impossible de lire l'adresse du contrat. Ouvre la fenêtre "Deploy" et copie-la dans les .env.
) else (
  echo [start-all] Contrat = %CONTRACT%

  REM 4) Met à jour les .env (gateway et UI)
  powershell -NoProfile -Command ^
    "(Get-Content 'gateway-server/.env') -replace '^CONTRACT_ADDR=.*','CONTRACT_ADDR=%CONTRACT%' | Set-Content 'gateway-server/.env'"
  powershell -NoProfile -Command ^
    "(Get-Content 'ui/.env') -replace '^VITE_CONTRACT_ADDR=.*','VITE_CONTRACT_ADDR=%CONTRACT%' | Set-Content 'ui/.env'"
)

REM 5) Démarre Gateway, Mock et UI
start "Gateway" cmd /k "cd /d gateway-server && node index.js"
start "Mock"    cmd /k "cd /d gateway-server && node mock.js"
start "UI"      cmd /k "cd /d ui && npm run dev"

endlocal

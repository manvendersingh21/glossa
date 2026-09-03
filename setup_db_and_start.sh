#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

sudo -u postgres psql -c "CREATE USER glossa WITH PASSWORD 'glossa';"
sudo -u postgres psql -c "CREATE DATABASE glossa OWNER glossa;"
sudo -u postgres psql -d glossa -c "CREATE EXTENSION postgis;"

npm run db:migrate
npm run data:ingest
npm run build
nohup npm start > next.log 2>&1 &
echo "App started!"

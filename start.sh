#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export $(cat .env | grep -v '^#' | xargs)
nohup npm start > next.log 2>&1 &

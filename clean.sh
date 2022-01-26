#!/bin/sh

echo "Removing Vedai application containers ..."
docker rm vedai-web-server vedai-web-client vedai-mongodb vedai-substrate-node -f
echo "Removing Vedai application volumes ..."
docker volume rm vedai-blockchain vedai-filestorage vedai-logstorage vedai-mongostorage -f
echo "Vedai application containers and volumes removed"
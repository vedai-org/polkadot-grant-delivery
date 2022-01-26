#!/bin/sh

echo "Creating appliction volumes ..."
docker volume create --name=vedai-blockchain && docker volume create --name=vedai-filestorage && docker volume create --name=vedai-logstorage && docker volume create --name=vedai-mongostorage
echo "Starting appliction containers ..."
docker-compose up -d
echo "Waiting for Vedai application containers to start ..."
sleep 3
echo "Installing npm packages for a setup script ..."
npm install
echo "Running the setup script for Vedai application ..."
npm run setup
echo "Vedai application containers started"
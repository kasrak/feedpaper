#!/bin/sh

echo "Building electron app..."
cd app
npm install
npm run build

echo "Building next.js client..."
cd ../client
npm install
npm run build

rm -rf ../app/dist/client
mv out ../app/dist/client

echo "Packaging electron app..."
cd ../app
npm run package
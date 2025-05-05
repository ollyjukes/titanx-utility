#!/bin/bash

# Change working directory to the root of the project
cd "$(dirname "$0")/.." || exit 1

{
  echo "================= Includes the following config and environment files ================="
  find . \
    -type f \
    \( -name "*.env*" -o -name "*.config.js" -o -name "*.config.mjs" -o -name "*.config.json" -o -name "jsconfig.json" -o -name ".eslintrc.json" -o -name "next.config.mjs" \) \
    -not -path "./node_modules/*" \
    -not -path "./.next/*" \
    -not -path "./coverage/*" \
    -not -path "./logs/*" \
    -not -path "./.vercel/*" \
    -not -name "*.txt" \
    -not -name "package-lock.json" \
    -not -name "config.js" \
    -print

  echo -e "\n\n================= Contents of above config and environment files =================\n"

  find . \
    -type f \
    \( -name "*.env*" -o -name "*.config.js" -o -name "*.config.mjs" -o -name "*.config.json" -o -name "jsconfig.json" -o -name ".eslintrc.json" -o -name "next.config.mjs" \) \
    -not -path "./node_modules/*" \
    -not -path "./.next/*" \
    -not -path "./coverage/*" \
    -not -path "./logs/*" \
    -not -path "./.vercel/*" \
    -not -name "*.txt" \
    -not -name "package-lock.json" \
    -not -name "config.js" \
    -exec bash -c 'echo -e "\n----- {} -----\n"; cat {}' \;

  echo -e "\n\n================= Includes the following config and environment files ================="
  find . \
    -type f \
    \( -name "*.env*" -o -name "*.config.js" -o -name "*.config.mjs" -o -name "*.config.json" -o -name "jsconfig.json" -o -name ".eslintrc.json" -o -name "next.config.mjs" \) \
    -not -path "./node_modules/*" \
    -not -path "./.next/*" \
    -not -path "./coverage/*" \
    -not -path "./logs/*" \
    -not -path "./.vercel/*" \
    -not -name "*.txt" \
    -not -name "package-lock.json" \
    -not -name "config.js" \
    -print
} > config_env_output.txt

clear
cat config_env_output.txt

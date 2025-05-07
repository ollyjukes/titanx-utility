#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Collect all .js files in ./server and ./contracts
included_files=$(find app/api app/lib ./contracts -type f -name "*.js" | sort)

{
  echo "================= Includes the following JS files under ./server and ./contracts ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files =================\n"

  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following JS files under ./server and ./contracts ================="
  echo "$included_files"
} > scripts/out/server_and_contracts_output.txt

clear
cat scripts/out/server_and_contracts_output.txt


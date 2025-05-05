#!/bin/bash

# Change working directory to the root of the project
cd "$(dirname "$0")/.." || exit 1

# Find all .js files in ./server
included_files=$(find app/api app/lib client/lib -type f -name "*.js" | sort)

{
  echo "================= Includes the following JS files under ./server ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files in ./server =================\n"

  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following JS files under ./server ================="
  echo "$included_files"
} > server_output.txt

clear
cat server_output.txt

